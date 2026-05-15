import { type Interactions } from '@google/genai';
import { extractRichVisionLines } from '../providers/vision.js';
import {
  accumulateUsage,
  deleteFromFilesApi,
  geminiClient,
  generationConfig,
  generationConfigTool,
  getResponseText,
  uploadToFilesApi,
} from '../providers/gemini.js';
import { NidResultSchema, type NidResult } from '../core/models.js';
import { StepTimer } from '../core/timer.js';
import { Tier1SmartResultSchema, type LineRecord, type SmartRoutingDecision } from '../core/smartTypes.js';
import { SMART_TIER1_PROMPT } from '../prompts/smartTier1.js';
import { SMART_TIER2_PROMPT } from '../prompts/smartTier2.js';
import { NID_JSON_SCHEMA } from '../utils/nidSchema.js';
import { extractJson } from '../utils/json.js';
import { normalizeNidJson } from '../utils/normalize.js';
import { cropImageByBox, mergeBoundingBoxes } from '../utils/imageCrop.js';
import { routeSmartFields } from '../utils/fieldValidators.js';
import { crossFieldCheck } from '../utils/crossFieldCheck.js';
import { config } from '../config/index.js';
import type { ExtractionResult, NidImage, VisionOutput } from '../core/types.js';
import type { IExtractionStrategy } from './IExtractionStrategy.js';

function formatLines(lines: LineRecord[]): string {
  return lines
    .map(line => `[${line.id}] side=${line.side} conf=${line.confidence.toFixed(3)} text=${JSON.stringify(line.text)}`)
    .join('\n');
}

function fieldReviewList(result: NidResult): string[] {
  const listed = new Set(result.fieldsNeedingReview);
  for (const issue of crossFieldCheck(result)) listed.add(issue.field);
  return [...listed];
}

function withReviewList(result: NidResult): NidResult {
  const fieldsNeedingReview = fieldReviewList(result);
  const overallConfidence = fieldsNeedingReview.length > 0
    ? (result.overallConfidence === 'high' ? 'medium' : result.overallConfidence)
    : result.overallConfidence;
  return { ...result, fieldsNeedingReview, overallConfidence };
}

function findLineBoxes(lines: LineRecord[], lineIds: string[]) {
  const idSet = new Set(lineIds);
  return lines
    .filter(line => idSet.has(line.id) && line.boundingBox)
    .map(line => line.boundingBox!);
}

async function uploadOriginalImages(images: NidImage[], timer: StepTimer): Promise<string[]> {
  const stop = timer.start('files_upload_originals');
  const uris = await Promise.all(images.map(img => uploadToFilesApi(img.buffer, img.mimeType)));
  stop();
  return uris;
}

/**
 * Smart adaptive strategy.
 *
 * Flow:
 * 1. Rich Cloud Vision OCR on all sides.
 * 2. Tier-1 Flash Lite text-only parse using CV lines + confidence.
 * 3. Deterministic validators route uncertain fields.
 * 4. Tier-2 Pro vision pass only when routing requests verification.
 */
export class SmartStrategy implements IExtractionStrategy {
  readonly mode = 'smart' as const;

  async extract(images: NidImage[]): Promise<ExtractionResult> {
    const timer = new StepTimer();
    const interactions: Interactions.Interaction[] = [];
    const uploadedUris: string[] = [];

    try {
      const richResults = await Promise.all(
        images.map(async (img) => {
          const stop = timer.start(`vision_${img.side}`);
          const result = await extractRichVisionLines(img);
          stop();
          const ms = timer.summary().steps[`vision_${img.side}`]?.ms ?? 0;
          return { img, ...result, ms };
        }),
      );

      const allLines = richResults.flatMap(result => result.lines);
      const visionOutputs: VisionOutput[] = richResults.map(result => ({
        side: result.img.side,
        rawText: result.rawText,
        timingMs: result.ms,
      }));

      const tier1Stop = timer.start('gemini_tier1_text_parse');
      const tier1Interaction = await geminiClient().interactions.create({
        model:              config.smart.tier1Model,
        system_instruction: SMART_TIER1_PROMPT,
        generation_config:  { ...generationConfig, thinking_level: 'minimal', thinking_summaries: 'none' },
        response_format:    {
          type: 'text',
          mime_type: 'application/json',
        } satisfies Interactions.TextResponseFormat,
        input: [
          {
            type: 'text',
            text: [
              'Parse the Cloud Vision OCR lines below.',
              `CV confidence threshold for auto-pass: ${config.smart.cvConfidenceThreshold}`,
              '',
              formatLines(allLines),
            ].join('\n'),
          } satisfies Interactions.TextContent,
        ],
      });
      tier1Stop();
      interactions.push(tier1Interaction);

      const tier1Raw = extractJson(getResponseText(tier1Interaction)) as Record<string, unknown>;
      const tier1 = Tier1SmartResultSchema.parse({
        ...tier1Raw,
        extraction: normalizeNidJson(tier1Raw['extraction']),
      });
      const routing = routeSmartFields(tier1, config.smart.cvConfidenceThreshold);
      const verify = routing
        .filter((decision): decision is SmartRoutingDecision & { action: 'verify' } => decision.action === 'verify')
        .slice(0, config.smart.maxTier2Fields);

      if (verify.length === 0) {
        return {
          mode: this.mode,
          extraction: withReviewList(tier1.extraction),
          visionOutputs,
          timing: timer.summary(),
          geminiCallCount: interactions.length,
          tokenUsage: accumulateUsage(interactions),
        };
      }

      const originalUris = await uploadOriginalImages(images, timer);
      uploadedUris.push(...originalUris);

      const cropParts: Interactions.Content[] = [];
      const cropUploads: string[] = [];
      for (const decision of verify) {
        const source = decision.source;
        if (!source) continue;
        const image = images.find(img => img.side === source.side);
        if (!image) continue;
        const box = mergeBoundingBoxes(findLineBoxes(allLines, source.lineIds));
        if (!box) continue;
        const cropStop = timer.start('crop_field');
        const crop = await cropImageByBox(image.buffer, box);
        cropStop();
        const uploadStop = timer.start('files_upload_crops');
        const cropUri = await uploadToFilesApi(crop, 'image/jpeg');
        uploadStop();
        cropUploads.push(cropUri);
        cropParts.push(
          {
            type: 'text',
            text: `Crop for field=${decision.field}, side=${source.side}, reason=${decision.reason}`,
          } satisfies Interactions.TextContent,
          { type: 'image', uri: cropUri } satisfies Interactions.ImageContent,
        );
      }
      uploadedUris.push(...cropUploads);

      const tier2Stop = timer.start('gemini_tier2_visual_verify');
      const tier2Interaction = await geminiClient().interactions.create({
        model:              config.smart.tier2Model,
        system_instruction: SMART_TIER2_PROMPT,
        generation_config:  generationConfigTool,
        response_format:    {
          type: 'text',
          mime_type: 'application/json',
          schema: NID_JSON_SCHEMA,
        } satisfies Interactions.TextResponseFormat,
        input: [
          {
            type: 'text',
            text: [
              'Tier-1 extraction and routing decisions follow.',
              'Return a full corrected NID result object.',
              '',
              'TIER_1_EXTRACTION:',
              JSON.stringify(tier1.extraction, null, 2),
              '',
              'FIELDS_TO_VERIFY:',
              JSON.stringify(verify, null, 2),
              '',
              'Original side images follow, then targeted field crops.',
            ].join('\n'),
          } satisfies Interactions.TextContent,
          ...originalUris.map((uri): Interactions.ImageContent => ({ type: 'image', uri })),
          ...cropParts,
        ],
      });
      tier2Stop();
      interactions.push(tier2Interaction);

      const extraction = withReviewList(
        NidResultSchema.parse(normalizeNidJson(extractJson(getResponseText(tier2Interaction)))),
      );

      return {
        mode: this.mode,
        extraction,
        visionOutputs,
        timing: timer.summary(),
        geminiCallCount: interactions.length,
        tokenUsage: accumulateUsage(interactions),
      };
    } finally {
      void Promise.all(uploadedUris.map(deleteFromFilesApi));
    }
  }
}

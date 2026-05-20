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
import { Tier1SmartResultSchema, NID_FIELD_KEYS, type LineRecord, type SmartRoutingDecision } from '../core/smartTypes.js';
import { SMART_TIER1_PROMPT } from '../prompts/smartTier1.js';
import { SMART_TIER2_PROMPT } from '../prompts/smartTier2.js';
import { NID_JSON_SCHEMA } from '../utils/nidSchema.js';
import { extractJson } from '../utils/json.js';
import { normalizeNidJson } from '../utils/normalize.js';
import { cropImageByBox, mergeBoundingBoxes } from '../utils/imageCrop.js';
import { routeSmartFields, expectedSideForField } from '../utils/fieldValidators.js';
import { crossFieldCheck } from '../utils/crossFieldCheck.js';
import { detectGlare, bboxOverlapsGlare, type GlareReport } from '../utils/glareDetection.js';
import { enhanceForGlareRecovery, enhanceForGapRecovery, enhanceNegatedForGap } from '../utils/imageEnhance.js';
import { detectLabelValueGaps, type GapReport } from '../utils/gapDetection.js';
import { detectCombinedSides, reclassifyLines } from '../utils/sideClassification.js';
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
 * Looks up the NidImage backing a logical side. When the user uploaded a
 * single image containing BOTH sides (auto-detected via sideClassification),
 * its `side` is 'combined' — this helper falls back to that combined image
 * when no exact-side image exists. Used for cropping back-side bboxes against
 * the combined buffer.
 */
function findImageForSide(images: NidImage[], side: NidImage['side']): NidImage | undefined {
  return images.find(img => img.side === side)
      ?? images.find(img => img.side === 'combined');
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

      let allLines = richResults.flatMap(result => result.lines);

      // Combined-sides detection: if a single image was provided and its CV text
      // contains BOTH front-side and back-side keyword markers, treat it as a
      // single image containing both card sides. We:
      //   - mutate that NidImage's side to 'combined'
      //   - reclassify its lines by Y-coordinate into front/back
      //   - downstream routing will see providedSides={front,back} for it
      for (const result of richResults) {
        if (result.img.side !== 'front' && result.img.side !== 'unknown') continue;
        const detection = detectCombinedSides(result.lines);
        if (!detection.isCombined) continue;
        result.img.side = 'combined';
        const reclassified = reclassifyLines(result.lines, detection.splitY);
        // Replace this image's lines in-place inside the shared allLines list
        result.lines = reclassified;
      }
      allLines = richResults.flatMap(result => result.lines);

      const visionOutputs: VisionOutput[] = richResults.map(result => ({
        side: result.img.side,
        rawText: result.rawText,
        timingMs: result.ms,
      }));

      // Layout-aware gap analysis: detect label-only lines whose value block is
      // separated by an anomalously large horizontal gap (> 80 px). This catches
      // fields where flash/glare obliterated the value prefix that CV never saw.
      const gapReports = detectLabelValueGaps(allLines);
      const gapByField = new Map<string, GapReport>(gapReports.map(r => [r.field, r]));

      // Capture-quality analysis: detect flash glare / saturated regions per side.
      // Used downstream to decide which Tier-2 inputs need CLAHE enhancement.
      const glareStop = timer.start('glare_detection');
      const glareReports = await Promise.all(
        images.map(async (img) => ({
          side: img.side,
          report: await detectGlare(img.buffer),
        })),
      );
      glareStop();
      // Combined images cover both front and back — duplicate their glare report
      // under both keys so downstream side-based lookups (front/back) find it.
      const glareBySide = new Map<NidImage['side'], GlareReport>();
      for (const r of glareReports) {
        if (r.side === 'combined') {
          glareBySide.set('front', r.report);
          glareBySide.set('back',  r.report);
        } else {
          glareBySide.set(r.side, r.report);
        }
      }

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

      // Parse Tier-1 response — flash-lite may return flat NID JSON or a wrapper object.
      // Either form is accepted; fallback to full verify if parsing fails entirely.
      let tier1 = null as import('../core/smartTypes.js').Tier1SmartResult | null;
      let rawObj: Record<string, unknown> = {};
      try {
        const parsed = extractJson(getResponseText(tier1Interaction));
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          rawObj = parsed as Record<string, unknown>;
        }
      } catch { /* empty rawObj → tier1 stays null */ }

      try {
        // Auto-detect wrapper vs flat: flat NID JSON has 'cardType' at top level
        const extractionSrc = 'extraction' in rawObj ? rawObj['extraction'] : rawObj;
        tier1 = Tier1SmartResultSchema.parse({
          extraction:   normalizeNidJson(extractionSrc),
          fieldSources: rawObj['fieldSources'] ?? {},
        });
      } catch (parseErr) {
        console.warn('[smart] Tier-1 parse failed, routing all fields to Tier-2:',
          parseErr instanceof Error ? parseErr.message : parseErr);
      }

      // Build providedSides — treating 'combined' images as providing BOTH sides.
      const providedSides = new Set<NidImage['side']>();
      for (const img of images) {
        if (img.side === 'combined') {
          providedSides.add('front');
          providedSides.add('back');
        } else {
          providedSides.add(img.side);
        }
      }
      const baseRouting = tier1
        ? routeSmartFields(tier1, config.smart.cvConfidenceThreshold, providedSides)
        : NID_FIELD_KEYS.map((field): SmartRoutingDecision => ({
            field,
            action: 'verify',
            reason: 'Tier-1 parse failed — full visual verification',
          }));

      // Gap-detection upgrade: any PASS field with a detected label-value gap is
      // promoted to verify regardless of Tier-1 confidence. The gap itself is
      // evidence of missing text that Tier-1 could not have seen.
      const routing = baseRouting.map((decision): SmartRoutingDecision => {
        if (decision.action !== 'pass') return decision;
        const gap = gapByField.get(decision.field);
        if (!gap) return decision;
        return {
          ...decision,
          action: 'verify',
          reason: `gap_detected: label-only block with value separated by ${gap.gapPx}px (threshold ${80}px)`,
        };
      });

      const verify = routing
        .filter((decision): decision is SmartRoutingDecision & { action: 'verify' } => decision.action === 'verify')
        .slice(0, config.smart.maxTier2Fields);

      // Track which fields Tier-2 will actually examine.
      // Fields NOT in this set were action:'pass' — their Tier-1 values are trusted
      // and must be copied back after Tier-2 to prevent regression (e.g. Tier-2
      // returning null for a clearly-readable field it was never asked to verify).
      const verifyFieldSet = new Set(verify.map(d => d.field));

      if (verify.length === 0 && tier1) {
        return {
          mode: this.mode,
          extraction: withReviewList({ ...tier1.extraction, qualityIssues: [] }),
          visionOutputs,
          timing: timer.summary(),
          geminiCallCount: interactions.length,
          tokenUsage: accumulateUsage(interactions),
        };
      }

      const originalUris = await uploadOriginalImages(images, timer);
      uploadedUris.push(...originalUris);

      // Glare-aware verify loop:
      //  - Bbox known + bbox overlaps glare → render crop from a CLAHE-enhanced source.
      //  - Bbox unknown (expected_field_missing routing) + side has glare → upload an
      //    enhanced full-side image so Tier-2 has a chance to recover the field.
      //  - Otherwise: same original-image crop as before.
      const cropParts: Interactions.Content[] = [];
      const qualityIssues: string[] = [];
      const enhancedFullSideUris: Partial<Record<NidImage['side'], string>> = {};
      const cardTypeForRouting = tier1?.extraction.cardType ?? 'unknown';

      const ensureEnhancedSide = async (side: NidImage['side']): Promise<string | null> => {
        const cached = enhancedFullSideUris[side];
        if (cached) return cached;
        const img = findImageForSide(images, side);
        if (!img) return null;
        const enhStop = timer.start('enhance_image');
        const enhanced = await enhanceForGlareRecovery(img.buffer);
        enhStop();
        const upStop = timer.start('files_upload_enhanced');
        const uri = await uploadToFilesApi(enhanced, 'image/jpeg');
        upStop();
        uploadedUris.push(uri);
        enhancedFullSideUris[side] = uri;
        return uri;
      };

      for (const decision of verify) {
        // ── Gap-detected path: send THREE enhancement variants so Tier-2 has the
        // best chance to detect partial letter strokes in the obliterated zone.
        //   variant 1 (raw)        — original pixels, no processing
        //   variant 2 (aggressive) — CLAHE 20px + gamma 2.4; fine stroke detail
        //   variant 3 (negated)    — glare→dark, strokes→bright (ৎ edge pop)
        const gapReport = gapByField.get(decision.field);
        if (gapReport && providedSides.has(gapReport.side)) {
          const image = findImageForSide(images, gapReport.side);
          if (image) {
            const enhStop = timer.start('enhance_image');
            const [aggressiveBuf, negatedBuf] = await Promise.all([
              enhanceForGapRecovery(image.buffer),
              enhanceNegatedForGap(image.buffer),
            ]);
            enhStop();

            const cropStop = timer.start('crop_field');
            const [rawCrop, aggressiveCrop, negatedCrop] = await Promise.all([
              cropImageByBox(image.buffer,    gapReport.fullCropBbox, 0.15),
              cropImageByBox(aggressiveBuf,   gapReport.fullCropBbox, 0.15),
              cropImageByBox(negatedBuf,      gapReport.fullCropBbox, 0.15),
            ]);
            cropStop();

            const upStop = timer.start('files_upload_crops');
            const [uriRaw, uriAgg, uriNeg] = await Promise.all([
              uploadToFilesApi(rawCrop,        'image/jpeg'),
              uploadToFilesApi(aggressiveCrop, 'image/jpeg'),
              uploadToFilesApi(negatedCrop,    'image/jpeg'),
            ]);
            upStop();
            uploadedUris.push(uriRaw, uriAgg, uriNeg);
            qualityIssues.push(`gap_${decision.field}`);

            const gapLabel = `[GAP DETECTED] field=${decision.field}, side=${gapReport.side}, gap=${gapReport.gapPx}px`;
            cropParts.push(
              { type: 'text', text: `${gapLabel} — RAW crop (original pixels)` } satisfies Interactions.TextContent,
              { type: 'image', uri: uriRaw } satisfies Interactions.ImageContent,
              { type: 'text', text: `${gapLabel} — AGGRESSIVE crop (CLAHE 20px + gamma 2.4; amplifies partial strokes)` } satisfies Interactions.TextContent,
              { type: 'image', uri: uriAgg } satisfies Interactions.ImageContent,
              { type: 'text', text: `${gapLabel} — NEGATED crop (glare→dark, strokes→bright; look for ৎ/ত at right edge of dark zone)` } satisfies Interactions.TextContent,
              { type: 'image', uri: uriNeg } satisfies Interactions.ImageContent,
            );
            continue;
          }
        }

        // ── Standard path: source bbox or glare-enhanced full-side image
        const source = decision.source;
        const targetSide: NidImage['side'] | null =
          source?.side ?? expectedSideForField(decision.field, cardTypeForRouting);
        if (!targetSide || !providedSides.has(targetSide)) continue;

        const image = findImageForSide(images, targetSide);
        if (!image) continue;

        const box = source && source.lineIds.length > 0
          ? mergeBoundingBoxes(findLineBoxes(allLines, source.lineIds))
          : null;

        const glare = glareBySide.get(targetSide);
        const overlapsGlare = box && glare ? bboxOverlapsGlare(box, glare) : false;
        const sideHasGlare  = (glare?.coverage ?? 0) > 0.005;
        const useEnhanced   = box ? overlapsGlare : sideHasGlare;

        if (useEnhanced) qualityIssues.push(`glare_${decision.field}`);

        if (box) {
          let sourceBuf = image.buffer;
          if (useEnhanced) {
            const enhStop = timer.start('enhance_image');
            sourceBuf = await enhanceForGlareRecovery(image.buffer);
            enhStop();
          }
          const cropStop = timer.start('crop_field');
          const crop = await cropImageByBox(sourceBuf, box);
          cropStop();
          const upStop = timer.start('files_upload_crops');
          const cropUri = await uploadToFilesApi(crop, 'image/jpeg');
          upStop();
          uploadedUris.push(cropUri);
          cropParts.push(
            {
              type: 'text',
              text: `${useEnhanced ? '[ENHANCED] ' : ''}Crop for field=${decision.field}, side=${targetSide}, reason=${decision.reason}`,
            } satisfies Interactions.TextContent,
            { type: 'image', uri: cropUri } satisfies Interactions.ImageContent,
          );
        } else if (useEnhanced) {
          const enhancedUri = await ensureEnhancedSide(targetSide);
          if (enhancedUri) {
            cropParts.push(
              {
                type: 'text',
                text: `[ENHANCED] Full ${targetSide} side — field=${decision.field} missing from OCR; ${((glare?.coverage ?? 0) * 100).toFixed(1)}% glare coverage`,
              } satisfies Interactions.TextContent,
              { type: 'image', uri: enhancedUri } satisfies Interactions.ImageContent,
            );
          }
        }
      }

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
              tier1 ? JSON.stringify(tier1.extraction, null, 2) : '(Tier-1 parse failed — extract from images only)',
              '',
              'FIELDS_TO_VERIFY:',
              JSON.stringify(verify, null, 2),
              '',
              qualityIssues.length > 0
                ? `DETECTED_QUALITY_ISSUES (glare overlap): ${qualityIssues.join(', ')}`
                : 'AUTOMATED_QUALITY_ANALYSIS: no glare overlap detected',
              '',
              'Inputs below: original side image(s), then targeted crops and enhanced variants for verify fields.',
            ].join('\n'),
          } satisfies Interactions.TextContent,
          ...originalUris.map((uri): Interactions.ImageContent => ({ type: 'image', uri })),
          ...cropParts,
        ],
      });
      tier2Stop();
      interactions.push(tier2Interaction);

      const tier2Parsed = NidResultSchema.parse(
        normalizeNidJson(extractJson(getResponseText(tier2Interaction))),
      );

      // Merge: Tier-2 result for verified fields, Tier-1 result for PASS fields.
      // This prevents Tier-2 from regressing on fields it was never shown
      // (e.g. overwriting a correctly-extracted fatherNameBn with null).
      const FIELD_KEYS_TYPED: ReadonlyArray<keyof import('../core/models.js').NidResult> = [
        'nidNumber', 'nameEn', 'nameBn', 'dateOfBirth', 'fatherNameBn', 'motherNameBn',
        'addressBn', 'bloodGroup', 'issueDate', 'placeOfBirth', 'validUntil',
      ];
      const mergedExtraction = { ...tier2Parsed } as Record<string, unknown>;
      if (tier1) {
        for (const field of FIELD_KEYS_TYPED) {
          if (!verifyFieldSet.has(field as import('../core/smartTypes.js').NidFieldKey)) {
            mergedExtraction[field] = tier1.extraction[field as keyof typeof tier1.extraction];
          }
        }
      }

      // Strategy-detected issues (from glare/gap) + model-confirmed issues, deduped.
      const mergedIssues = Array.from(new Set([
        ...qualityIssues,
        ...(tier2Parsed.qualityIssues ?? []),
      ]));
      const extraction = withReviewList({
        ...(mergedExtraction as import('../core/models.js').NidResult),
        qualityIssues: mergedIssues,
      });

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

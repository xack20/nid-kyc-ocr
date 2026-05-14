import { type Interactions } from '@google/genai';
import { extractWithCloudVision } from '../providers/vision.js';
import { geminiClient, getResponseText, getFunctionCallStep, accumulateUsage, generationConfig } from '../providers/gemini.js';
import { SYSTEM_INSTRUCTION } from '../prompts/system.js';
import { NidResultSchema } from '../core/models.js';
import { StepTimer } from '../core/timer.js';
import { toImageMimeType } from '../utils/mime.js';
import { extractJson }       from '../utils/json.js';
import { normalizeNidJson }  from '../utils/normalize.js';
import { config } from '../config/index.js';
import type { NidImage, ExtractionResult, VisionOutput } from '../core/types.js';
import type { IExtractionStrategy } from './IExtractionStrategy.js';

/**
 * Combined strategy — maximum accuracy.
 *
 * 1. Cloud Vision always runs first on all images (guaranteed double-blind pass).
 * 2. CV text is passed as context to Gemini.
 * 3. Cloud Vision is also registered as a function tool so Gemini can re-invoke
 *    it for extra verification on ambiguous fields.
 */
export class CombinedStrategy implements IExtractionStrategy {
  readonly mode = 'combined' as const;

  async extract(images: NidImage[]): Promise<ExtractionResult> {
    const timer = new StepTimer();
    const visionOutputs: VisionOutput[] = [];

    // Step 1: Cloud Vision on all images in parallel (guaranteed pre-pass)
    const visionResults = await Promise.all(
      images.map(async (img) => {
        const stepName = `vision_${img.side}`;
        const stop = timer.start(stepName);
        const rawText = await extractWithCloudVision(img.buffer);
        stop();
        const ms = timer.summary().steps[stepName]?.ms ?? 0;
        return { img, rawText, ms };
      }),
    );

    for (const { img, rawText, ms } of visionResults) {
      visionOutputs.push({ side: img.side, rawText, timingMs: ms });
    }

    // Cache for function-call re-runs (avoids duplicate API calls)
    const visionCache = new Map(visionResults.map(({ img, rawText }) => [img.side, rawText]));

    // Step 2: Build Gemini input — CV context + images + tool
    const cvContext = visionResults
      .map(({ img, rawText }) =>
        `Cloud Vision — ${img.side.toUpperCase()}:\n---\n${rawText || '(no text detected)'}\n---`,
      )
      .join('\n\n');

    const inputParts: Interactions.Content[] = [
      {
        type: 'text',
        text: `${cvContext}\n\nNow examine the image(s) below, extract all fields, and cross-verify with the Cloud Vision text above.`,
      } satisfies Interactions.TextContent,
      ...visionResults.map(
        ({ img }): Interactions.ImageContent => ({
          type:      'image',
          data:      img.buffer.toString('base64'),
          mime_type: toImageMimeType(img.mimeType),
        }),
      ),
    ];

    const stopInitial = timer.start('gemini_initial');
    let interaction = await geminiClient().interactions.create({
      model:              config.gemini.model,
      system_instruction: SYSTEM_INSTRUCTION,
      generation_config:  generationConfig,
      input:              inputParts,
      tools: [
        {
          type:        'function',
          name:        'get_cloud_vision_ocr',
          description: 'Re-runs Cloud Vision on a NID image side for additional field verification.',
          parameters: {
            type:       'object',
            properties: {
              side:   { type: 'string', enum: ['front', 'back', 'unknown'], description: 'Which side to re-run' },
              reason: { type: 'string', description: 'Which field is ambiguous' },
            },
            required: ['side', 'reason'],
          },
        } satisfies Interactions.Function,
      ],
    });
    stopInitial();

    let geminiCallCount = 1;
    const allInteractions = [interaction];

    // Step 3: Function-call loop
    while (interaction.status === 'requires_action') {
      const step = getFunctionCallStep(interaction);
      if (!step || step.name !== 'get_cloud_vision_ocr') break;

      const sideRaw = (step.arguments?.side as string | undefined) ?? 'front';
      const side    = (['front', 'back', 'unknown'] as const).includes(sideRaw as 'front') ? sideRaw as 'front' | 'back' | 'unknown' : 'front';
      const rawText = visionCache.get(side) ?? visionCache.get('front') ?? '';

      const stopContinuation = timer.start(`gemini_continuation_${geminiCallCount}`);
      interaction = await geminiClient().interactions.create({
        model:                   config.gemini.model,
        previous_interaction_id: interaction.id,
        input: [
          {
            type:    'function_result',
            call_id: step.id,
            name:    step.name,
            result:  rawText,
          } satisfies Interactions.FunctionResultStep,
        ],
      });
      allInteractions.push(interaction);
      stopContinuation();
      geminiCallCount++;
    }

    const extraction = NidResultSchema.parse(normalizeNidJson(extractJson(getResponseText(interaction))));

    return {
      mode:            this.mode,
      extraction,
      visionOutputs,
      timing:          timer.summary(),
      geminiCallCount,
      tokenUsage:      accumulateUsage(allInteractions),
    };
  }
}

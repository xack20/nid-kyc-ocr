import { type Interactions } from '@google/genai';
import { extractWithCloudVision } from '../providers/vision.js';
import { geminiClient, getResponseText, accumulateUsage } from '../providers/gemini.js';
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
 * Cloud Vision runs first; its raw text is passed as context to Gemini.
 * Gemini does the structured extraction and cross-verification.
 * No function calling — Vision is never re-invoked.
 */
export class VisionFedGeminiStrategy implements IExtractionStrategy {
  readonly mode = 'vision_fed_gemini' as const;

  async extract(images: NidImage[]): Promise<ExtractionResult> {
    const timer = new StepTimer();
    const visionOutputs: VisionOutput[] = [];

    // Step 1: Cloud Vision on all images in parallel
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

    // Step 2: Build Gemini input — CV context + images
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

    // Step 3: Gemini — single call, no tool
    const stop = timer.start('gemini_initial');
    const interaction = await geminiClient().interactions.create({
      model:              config.gemini.model,
      system_instruction: SYSTEM_INSTRUCTION,
      input:              inputParts,
    });
    stop();

    const extraction = NidResultSchema.parse(normalizeNidJson(extractJson(getResponseText(interaction))));

    return {
      mode:            this.mode,
      extraction,
      visionOutputs,
      timing:          timer.summary(),
      geminiCallCount: 1,
      tokenUsage:      accumulateUsage([interaction]),
    };
  }
}

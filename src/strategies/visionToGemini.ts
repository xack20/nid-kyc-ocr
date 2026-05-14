import { type Interactions } from '@google/genai';
import { VISION_TO_GEMINI_PROMPT as SYSTEM_INSTRUCTION } from '../prompts/visionToGemini.js';
import { extractWithCloudVision }    from '../providers/vision.js';
import { geminiClient, getResponseText, accumulateUsage, generationConfig } from '../providers/gemini.js';
import { NidResultSchema }           from '../core/models.js';
import { StepTimer }                 from '../core/timer.js';
import { extractJson }               from '../utils/json.js';
import { normalizeNidJson }          from '../utils/normalize.js';
import { config }                    from '../config/index.js';
import type { NidImage, ExtractionResult, VisionOutput } from '../core/types.js';
import type { IExtractionStrategy }  from './IExtractionStrategy.js';



/**
 * Vision → Gemini (text-only) strategy.
 *
 * Cloud Vision extracts raw OCR text from the image(s).
 * Only that text — no image — is sent to Gemini for structured labeling.
 *
 * Cost advantage: zero image tokens charged to Gemini.
 * Trade-off: Gemini cannot see the image to resolve ambiguities in the OCR text.
 */
export class VisionToGeminiStrategy implements IExtractionStrategy {
  readonly mode = 'vision_to_gemini' as const;

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

    // Step 2: Build text-only prompt — no images sent to Gemini
    const ocrContext = visionResults
      .map(({ img, rawText }) =>
        `=== OCR TEXT (${img.side.toUpperCase()}) ===\n${rawText || '(no text detected)'}`,
      )
      .join('\n\n');

    const stopGemini = timer.start('gemini_initial');
    const interaction = await geminiClient().interactions.create({
      model:              config.gemini.model,
      system_instruction: SYSTEM_INSTRUCTION,
      generation_config:  generationConfig,
      input: [
        {
          type: 'text',
          text: `Parse the following raw Cloud Vision OCR text and extract all NID fields:\n\n${ocrContext}`,
        } satisfies Interactions.TextContent,
        // ← no image parts — text only
      ],
    });
    stopGemini();

    const extraction = NidResultSchema.parse(
      normalizeNidJson(extractJson(getResponseText(interaction))),
    );

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

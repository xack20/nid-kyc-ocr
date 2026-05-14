import { type Interactions } from '@google/genai';
import { geminiClient, getResponseText, accumulateUsage, generationConfig } from '../providers/gemini.js';
import { GEMINI_ONLY_PROMPT as SYSTEM_INSTRUCTION } from '../prompts/geminiOnly.js';
import { NidResultSchema } from '../core/models.js';
import { StepTimer } from '../core/timer.js';
import { toImageMimeType } from '../utils/mime.js';
import { extractJson }        from '../utils/json.js';
import { normalizeNidJson }   from '../utils/normalize.js';
import { config } from '../config/index.js';
import type { NidImage, ExtractionResult } from '../core/types.js';
import type { IExtractionStrategy } from './IExtractionStrategy.js';

/**
 * Gemini Interactions API only — no Cloud Vision.
 * Gemini reads the image(s) directly and extracts all fields.
 */
export class GeminiOnlyStrategy implements IExtractionStrategy {
  readonly mode = 'gemini_only' as const;

  async extract(images: NidImage[]): Promise<ExtractionResult> {
    const timer = new StepTimer();

    const inputParts: Interactions.Content[] = [
      {
        type: 'text',
        text: 'Extract all NID fields from the image(s) below.',
      } satisfies Interactions.TextContent,
      ...images.map(
        (img): Interactions.ImageContent => ({
          type:      'image',
          data:      img.buffer.toString('base64'),
          mime_type: toImageMimeType(img.mimeType),
        }),
      ),
    ];

    const stopGemini = timer.start('gemini_initial');
    let interaction = await geminiClient().interactions.create({
      model:              config.gemini.model,
      system_instruction: SYSTEM_INSTRUCTION,
      generation_config:  generationConfig,
      input:              inputParts,
    });
    stopGemini();

    const rawText    = getResponseText(interaction);
    const extraction = NidResultSchema.parse(normalizeNidJson(extractJson(rawText)));

    return {
      mode:            this.mode,
      extraction,
      visionOutputs:   [],
      timing:          timer.summary(),
      geminiCallCount: 1,
      tokenUsage:      accumulateUsage([interaction]),
    };
  }
}

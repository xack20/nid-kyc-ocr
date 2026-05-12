import { extractWithCloudVision } from '../providers/vision.js';
import { StepTimer } from '../core/timer.js';
import type { NidImage, ExtractionResult, VisionOutput } from '../core/types.js';
import type { IExtractionStrategy } from './IExtractionStrategy.js';

/**
 * Cloud Vision only — no Gemini.
 * Returns raw OCR text per image. No structured NID extraction.
 * Useful for debugging OCR quality or when Gemini is unavailable.
 */
export class VisionOnlyStrategy implements IExtractionStrategy {
  readonly mode = 'vision_only' as const;

  async extract(images: NidImage[]): Promise<ExtractionResult> {
    const timer = new StepTimer();
    const visionOutputs: VisionOutput[] = [];

    for (const img of images) {
      const stepName = `vision_${img.side}`;
      const stop = timer.start(stepName);
      const rawText = await extractWithCloudVision(img.buffer);
      const timingMs = Date.now();
      stop();
      const step = timer.summary().steps[stepName];
      visionOutputs.push({ side: img.side, rawText, timingMs: step?.ms ?? 0 });
    }

    return {
      mode:            this.mode,
      extraction:      undefined,
      visionOutputs,
      timing:          timer.summary(),
      geminiCallCount: 0,
      tokenUsage:      { inputTokens: 0, outputTokens: 0, totalTokens: 0, thoughtTokens: 0 },
    };
  }
}

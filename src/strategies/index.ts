import type { ExtractionMode } from '../core/types.js';
import type { IExtractionStrategy } from './IExtractionStrategy.js';
import { GeminiOnlyStrategy }           from './geminiOnly.js';
import { VisionOnlyStrategy }           from './visionOnly.js';
import { VisionFedGeminiStrategy }      from './visionFedGemini.js';
import { GeminiWithVisionToolStrategy } from './geminiWithVisionTool.js';
import { CombinedStrategy }             from './combined.js';

export type { IExtractionStrategy };
export { GeminiOnlyStrategy, VisionOnlyStrategy, VisionFedGeminiStrategy,
         GeminiWithVisionToolStrategy, CombinedStrategy };

/** Returns the strategy instance for the given mode. */
export function createStrategy(mode: ExtractionMode): IExtractionStrategy {
  switch (mode) {
    case 'gemini_only':              return new GeminiOnlyStrategy();
    case 'vision_only':              return new VisionOnlyStrategy();
    case 'vision_fed_gemini':        return new VisionFedGeminiStrategy();
    case 'gemini_with_vision_tool':  return new GeminiWithVisionToolStrategy();
    case 'combined':                 return new CombinedStrategy();
  }
}

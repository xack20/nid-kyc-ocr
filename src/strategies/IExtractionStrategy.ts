import type { NidImage, ExtractionResult, ExtractionMode } from '../core/types.js';

export interface IExtractionStrategy {
  readonly mode: ExtractionMode;
  /**
   * Extract NID fields from one or more card images.
   *
   * @param images  One or more NID images. Typically one (front) or two (front + back).
   */
  extract(images: NidImage[]): Promise<ExtractionResult>;
}

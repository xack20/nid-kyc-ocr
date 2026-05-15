import { ImageAnnotatorClient } from '@google-cloud/vision';

// ─── Lazy singleton ───────────────────────────────────────────────────────────

let _client: ImageAnnotatorClient | null = null;

function visionClient(): ImageAnnotatorClient {
  _client ??= new ImageAnnotatorClient();
  return _client;
}

// ─── OCR ──────────────────────────────────────────────────────────────────────

/**
 * Runs Document Text Detection on an image buffer.
 *
 * Configuration choices:
 *   languageHints: ['bn', 'en']  — Bengali + English only; improves accuracy
 *     by excluding similar-looking scripts (Arabic, Devanagari etc.)
 *
 *   enableTextDetectionConfidenceScore: true — returns per-character confidence
 *     scores used by the adaptive smart strategy for field-level routing.
 *
 *   advancedOcrOptions: ['legacyLayout'] — heuristic layout detection as
 *     an alternative to the default ML-based layout model. Works better for
 *     structured form layouts like NID cards where ML may overthink regions.
 *
 * @returns Raw OCR text, or empty string if nothing was detected.
 */
export async function extractWithCloudVision(imageBuffer: Buffer): Promise<string> {
  const [result] = await visionClient().documentTextDetection({
    image:        { content: imageBuffer },
    imageContext: {
      languageHints: ['bn', 'en'],
      textDetectionParams: {
        enableTextDetectionConfidenceScore: true,
        advancedOcrOptions: ['legacyLayout'],
      },
    },
  });
  return result.fullTextAnnotation?.text ?? '';
}

/**
 * Runs Document Text Detection and returns the full structured response
 * including per-word bounding boxes and confidence scores.
 * Used by the adaptive (smart) extraction strategy.
 */
export async function extractWithCloudVisionRich(imageBuffer: Buffer) {
  const [result] = await visionClient().documentTextDetection({
    image:        { content: imageBuffer },
    imageContext: {
      languageHints: ['bn', 'en'],
      textDetectionParams: {
        enableTextDetectionConfidenceScore: true,
        advancedOcrOptions: ['legacyLayout'],
      },
    },
  });
  return result;
}

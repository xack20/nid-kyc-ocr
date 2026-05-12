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
 * Language hints are fixed to Bengali + English for NID cards.
 *
 * @returns Raw OCR text, or empty string if nothing was detected.
 */
export async function extractWithCloudVision(imageBuffer: Buffer): Promise<string> {
  const [result] = await visionClient().documentTextDetection({
    image:        { content: imageBuffer },
    imageContext: { languageHints: ['bn', 'en'] },
  });
  return result.fullTextAnnotation?.text ?? '';
}

import { ImageAnnotatorClient } from '@google-cloud/vision';
import type { BoundingBox, LineRecord } from '../core/smartTypes.js';
import type { NidImage } from '../core/types.js';

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

function toBoundingBox(vertices: unknown): BoundingBox | undefined {
  if (!Array.isArray(vertices)) return undefined;
  const points = vertices
    .map((v) => {
      const obj = v as { x?: number | null; y?: number | null };
      return { x: obj.x ?? 0, y: obj.y ?? 0 };
    })
    .filter(v => Number.isFinite(v.x) && Number.isFinite(v.y));
  return points.length > 0 ? { vertices: points } : undefined;
}

function wordText(word: unknown): string {
  const symbols = (word as { symbols?: Array<{ text?: string | null }> }).symbols ?? [];
  return symbols.map(s => s.text ?? '').join('');
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function paragraphText(paragraph: unknown): string {
  const words = (paragraph as { words?: unknown[] }).words ?? [];
  return words.map(wordText).filter(Boolean).join(' ');
}

function paragraphConfidence(paragraph: unknown): number {
  const words = (paragraph as { words?: Array<{ confidence?: number | null }> }).words ?? [];
  const wordScores = words
    .map(w => w.confidence ?? 0)
    .filter(score => score > 0);
  const own = (paragraph as { confidence?: number | null }).confidence ?? 0;
  return avg(wordScores) || own || 0;
}

function paragraphBox(paragraph: unknown): BoundingBox | undefined {
  const box = (paragraph as { boundingBox?: { vertices?: unknown[] } }).boundingBox;
  return toBoundingBox(box?.vertices);
}

export async function extractRichVisionLines(image: NidImage): Promise<{
  rawText: string;
  lines: LineRecord[];
}> {
  const result = await extractWithCloudVisionRich(image.buffer);
  const rawText = result.fullTextAnnotation?.text ?? '';
  const pages = result.fullTextAnnotation?.pages ?? [];
  const lines: LineRecord[] = [];

  let lineNo = 0;
  for (const page of pages as unknown[]) {
    const blocks = (page as { blocks?: unknown[] }).blocks ?? [];
    for (const block of blocks) {
      const paragraphs = (block as { paragraphs?: unknown[] }).paragraphs ?? [];
      for (const paragraph of paragraphs) {
        const text = paragraphText(paragraph).trim();
        if (!text) continue;
        lines.push({
          id: `${image.side}_${lineNo++}`,
          side: image.side,
          text,
          confidence: paragraphConfidence(paragraph),
          boundingBox: paragraphBox(paragraph),
        });
      }
    }
  }

  if (lines.length === 0 && rawText) {
    rawText.split(/\r?\n/).forEach((text, index) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      lines.push({
        id: `${image.side}_${index}`,
        side: image.side,
        text: trimmed,
        confidence: 0,
      });
    });
  }

  return { rawText, lines };
}

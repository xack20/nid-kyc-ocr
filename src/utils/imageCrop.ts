import sharp from 'sharp';
import type { BoundingBox } from '../core/smartTypes.js';

function bounds(box: BoundingBox, padding: number) {
  const xs = box.vertices.map(v => v.x);
  const ys = box.vertices.map(v => v.y);
  return {
    left:   Math.max(0, Math.floor(Math.min(...xs) - padding)),
    top:    Math.max(0, Math.floor(Math.min(...ys) - padding)),
    right:  Math.ceil(Math.max(...xs) + padding),
    bottom: Math.ceil(Math.max(...ys) + padding),
  };
}

export async function cropImageByBox(
  imageBuffer: Buffer,
  box: BoundingBox,
  padding = 24,
): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const b = bounds(box, padding);

  const left = Math.min(b.left, Math.max(0, width - 1));
  const top = Math.min(b.top, Math.max(0, height - 1));
  const extractWidth = Math.max(1, Math.min(width - left, b.right - left));
  const extractHeight = Math.max(1, Math.min(height - top, b.bottom - top));

  return sharp(imageBuffer)
    .extract({ left, top, width: extractWidth, height: extractHeight })
    .jpeg({ quality: 92 })
    .toBuffer();
}

export function mergeBoundingBoxes(boxes: BoundingBox[]): BoundingBox | undefined {
  if (boxes.length === 0) return undefined;
  const points = boxes.flatMap(box => box.vertices);
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return {
    vertices: [
      { x: Math.min(...xs), y: Math.min(...ys) },
      { x: Math.max(...xs), y: Math.min(...ys) },
      { x: Math.max(...xs), y: Math.max(...ys) },
      { x: Math.min(...xs), y: Math.max(...ys) },
    ],
  };
}

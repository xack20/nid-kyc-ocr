import sharp from 'sharp';
import type { BoundingBox } from '../core/smartTypes.js';

export interface GlareReport {
  /** Bounding boxes (in original image coords) of detected glare regions. */
  regions:  BoundingBox[];
  /** Fraction of image area flagged as glare-affected (0–1). */
  coverage: number;
  /** Original image dimensions — useful for downstream overlap checks. */
  width:    number;
  height:   number;
}

const CELL_SIZE = 32;        // analysis cells in original-image pixels
const LUM_CUTOFF = 210;      // 0-255 — JPEG compression softens peaks; 210 catches more flash spots

/**
 * Detects flash-glare regions by downsampling the image to a luminance grid
 * and flagging cells whose mean brightness exceeds LUM_CUTOFF. Adjacent
 * flagged cells are merged into rectangular bounding boxes.
 *
 * Why downsample: a 3 MB full-res scan is wasteful — we only need the
 * grid-level luminance map (a 32×32-pixel grid is plenty for NID-card
 * fields). sharp's resize+raw gives us a tiny byte array per channel.
 *
 * Why a flat-luminance threshold (no variance filter) in v1:
 *   - NID cards have a known light background, so high luminance on the
 *     card body is normal. Glare is distinguished by saturating right at
 *     the cutoff (240+) and obliterating local text — which is exactly
 *     what threshold-alone catches.
 *   - Variance-based discrimination can be added later if false positives
 *     show up on highly reflective laminate variants.
 */
export async function detectGlare(buffer: Buffer): Promise<GlareReport> {
  const meta = await sharp(buffer).metadata();
  const width  = meta.width  ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) {
    return { regions: [], coverage: 0, width, height };
  }

  const cellsX = Math.max(1, Math.ceil(width  / CELL_SIZE));
  const cellsY = Math.max(1, Math.ceil(height / CELL_SIZE));

  const { data } = await sharp(buffer)
    .grayscale()
    .resize(cellsX, cellsY, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const flagged: boolean[] = new Array(cellsX * cellsY).fill(false);
  let flaggedCount = 0;
  for (let i = 0; i < data.length && i < flagged.length; i++) {
    if (data[i] >= LUM_CUTOFF) {
      flagged[i] = true;
      flaggedCount++;
    }
  }

  const regions = mergeCellsToBBoxes(flagged, cellsX, cellsY, width, height);
  const coverage = flaggedCount / (cellsX * cellsY);
  return { regions, coverage, width, height };
}

/**
 * Connected-component scan over the cell grid. Adjacent (4-neighbour)
 * flagged cells become one bounding box. Returned boxes are in original
 * image coordinates.
 */
function mergeCellsToBBoxes(
  flagged: boolean[],
  cellsX:  number,
  cellsY:  number,
  imgW:    number,
  imgH:    number,
): BoundingBox[] {
  const seen: boolean[] = new Array(flagged.length).fill(false);
  const out: BoundingBox[] = [];
  const cellW = imgW / cellsX;
  const cellH = imgH / cellsY;

  for (let i = 0; i < flagged.length; i++) {
    if (!flagged[i] || seen[i]) continue;

    // BFS flood fill
    const queue: number[] = [i];
    let minCx = i % cellsX, maxCx = minCx;
    let minCy = Math.floor(i / cellsX), maxCy = minCy;

    while (queue.length > 0) {
      const idx = queue.shift()!;
      if (seen[idx] || !flagged[idx]) continue;
      seen[idx] = true;
      const cx = idx % cellsX;
      const cy = Math.floor(idx / cellsX);
      if (cx < minCx) minCx = cx;
      if (cx > maxCx) maxCx = cx;
      if (cy < minCy) minCy = cy;
      if (cy > maxCy) maxCy = cy;

      if (cx > 0)          queue.push(idx - 1);
      if (cx < cellsX - 1) queue.push(idx + 1);
      if (cy > 0)          queue.push(idx - cellsX);
      if (cy < cellsY - 1) queue.push(idx + cellsX);
    }

    const x0 = Math.floor(minCx * cellW);
    const y0 = Math.floor(minCy * cellH);
    const x1 = Math.ceil((maxCx + 1) * cellW);
    const y1 = Math.ceil((maxCy + 1) * cellH);
    out.push({
      vertices: [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
    });
  }

  return out;
}

/** Returns true if a field bbox spatially overlaps any glare region. */
export function bboxOverlapsGlare(field: BoundingBox, glare: GlareReport): boolean {
  const fx = field.vertices.map(v => v.x);
  const fy = field.vertices.map(v => v.y);
  const fMinX = Math.min(...fx), fMaxX = Math.max(...fx);
  const fMinY = Math.min(...fy), fMaxY = Math.max(...fy);

  for (const region of glare.regions) {
    const gx = region.vertices.map(v => v.x);
    const gy = region.vertices.map(v => v.y);
    const gMinX = Math.min(...gx), gMaxX = Math.max(...gx);
    const gMinY = Math.min(...gy), gMaxY = Math.max(...gy);

    if (fMinX < gMaxX && fMaxX > gMinX && fMinY < gMaxY && fMaxY > gMinY) {
      return true;
    }
  }
  return false;
}

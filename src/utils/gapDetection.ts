import type { NidFieldKey } from '../core/smartTypes.js';
import type { LineRecord, BoundingBox } from '../core/smartTypes.js';
import type { NidImage } from '../core/types.js';
import { mergeBoundingBoxes } from './imageCrop.js';

// ─── Label catalog ────────────────────────────────────────────────────────────

/**
 * Inline-layout labels: label and value appear on the SAME row.
 * Stacked-layout labels (Name:, Date of B., Issue Date, Blood Group) are
 * intentionally excluded — their value is on the next row by design.
 */
const INLINE_LABELS: Array<{ keyword: string; field: NidFieldKey }> = [
  { keyword: 'মাতা',   field: 'motherNameBn' },
  { keyword: 'পিতা',   field: 'fatherNameBn' },
  { keyword: 'স্বামী', field: 'fatherNameBn' },
  { keyword: 'নাম',    field: 'nameBn' },
  { keyword: 'ID NO',  field: 'nidNumber' },
  { keyword: 'NID No', field: 'nidNumber' },
];

/**
 * Horizontal gap threshold in pixels.
 *
 * Empirical baseline from the trigger image (WhatsApp Image 2026-04-20):
 *   নাম   → value gap  ≈ 39 px  (normal)
 *   স্বামী → value gap  ≈ 35 px  (normal)
 *   মাতা  → value gap  = 118 px  (ANOMALOUS — flash obliterated prefix)
 *
 * 80 px sits cleanly between normal and anomalous.
 */
const GAP_THRESHOLD_PX = 80;

/** Max horizontal distance to still be considered "same field, value to the right". */
const MAX_SEARCH_DISTANCE_PX = 500;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GapReport {
  field:        NidFieldKey;
  side:         NidImage['side'];
  /** Bounding box of the label-only block (e.g. "মাতা :"). */
  labelBbox:    BoundingBox;
  /** Bounding box of the partial-value block (e.g. "আরা বেগম"). Null when no value detected on the row. */
  valueBbox:    BoundingBox | null;
  /** Union of label + gap + value bboxes — used as the Tier-2 crop region. */
  fullCropBbox: BoundingBox;
  /** Measured horizontal pixel gap between label right-edge and value left-edge. */
  gapPx:        number;
}

// ─── Bbox helpers ─────────────────────────────────────────────────────────────

function minX(v: BoundingBox['vertices']): number { return Math.min(...v.map(p => p.x)); }
function maxX(v: BoundingBox['vertices']): number { return Math.max(...v.map(p => p.x)); }
function centerY(v: BoundingBox['vertices']): number {
  const ys = v.map(p => p.y);
  return (Math.min(...ys) + Math.max(...ys)) / 2;
}
function bboxHeight(v: BoundingBox['vertices']): number {
  const ys = v.map(p => p.y);
  return Math.max(...ys) - Math.min(...ys);
}

// ─── Label-only check ─────────────────────────────────────────────────────────

/**
 * Returns true if the line text consists only of the label keyword
 * (plus optional trailing colon / whitespace) — i.e. there is no value text
 * after the label on this line.
 *
 * Examples:
 *   isLabelOnlyLine("মাতা :", "মাতা")    → true
 *   isLabelOnlyLine("মাতা : আরা বেগম", "মাতা") → false
 */
function isLabelOnlyLine(text: string, keyword: string): boolean {
  const t = text.trim();
  const idx = t.indexOf(keyword);
  if (idx === -1) return false;
  // Everything after the keyword should be empty or just colon/whitespace
  const after = t.slice(idx + keyword.length).trim();
  return /^[:\s।]*$/.test(after);
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Detects fields where Cloud Vision split the label and partial-value into
 * separate blocks due to an anomalously large horizontal gap (flash glare,
 * occlusion, or blur obliterating text between them).
 *
 * Works on the existing LineRecord[] from extractRichVisionLines — no extra
 * CV API calls needed.
 *
 * Detection logic:
 *   For each line that is "label-only" (text is just a keyword + colon):
 *     1. Find the nearest other line on the same Y-row that lies to the right.
 *     2. Measure the horizontal gap.
 *     3. If gap > GAP_THRESHOLD_PX → emit GapReport.
 */
export function detectLabelValueGaps(lines: LineRecord[]): GapReport[] {
  const reports: GapReport[] = [];
  const seen = new Set<NidFieldKey>();

  for (const line of lines) {
    if (!line.boundingBox) continue;

    const match = INLINE_LABELS.find(entry => isLabelOnlyLine(line.text, entry.keyword));
    if (!match) continue;
    // Deduplicate: one report per field per side
    if (seen.has(match.field)) continue;

    const labelVerts  = line.boundingBox.vertices;
    const labelRight  = maxX(labelVerts);
    const labelCenterY = centerY(labelVerts);
    const lineH       = Math.max(bboxHeight(labelVerts), 10);

    // Find candidate value lines: same row, to the right, within search distance
    const candidates = lines
      .filter(other => {
        if (other === line || !other.boundingBox) return false;
        const otherLeft    = minX(other.boundingBox.vertices);
        const otherCenterY = centerY(other.boundingBox.vertices);
        return (
          Math.abs(otherCenterY - labelCenterY) <= lineH * 0.7 &&
          otherLeft > labelRight &&
          otherLeft - labelRight <= MAX_SEARCH_DISTANCE_PX
        );
      })
      .sort((a, b) =>
        minX(a.boundingBox!.vertices) - minX(b.boundingBox!.vertices),
      );

    const valueCandidate = candidates[0];
    const gapPx = valueCandidate
      ? minX(valueCandidate.boundingBox!.vertices) - labelRight
      : 0;

    if (gapPx <= GAP_THRESHOLD_PX) continue;

    const allBboxes: BoundingBox[] = [line.boundingBox];
    if (valueCandidate?.boundingBox) allBboxes.push(valueCandidate.boundingBox);
    const fullCropBbox = mergeBoundingBoxes(allBboxes);
    if (!fullCropBbox) continue;

    seen.add(match.field);
    reports.push({
      field:        match.field,
      side:         line.side,
      labelBbox:    line.boundingBox,
      valueBbox:    valueCandidate?.boundingBox ?? null,
      fullCropBbox,
      gapPx,
    });
  }

  return reports;
}

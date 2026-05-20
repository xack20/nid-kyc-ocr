import type { LineRecord, BoundingBox } from '../core/smartTypes.js';

// ─── Keyword catalogs ─────────────────────────────────────────────────────────

/**
 * Tokens that, if present in a line, indicate the line belongs to the FRONT side
 * of a Bangladesh NID. Match is case-insensitive.
 */
const FRONT_KEYWORDS = [
  'নাম',          // name label
  'name',         // English name label
  'পিতা',         // father label
  'father',       // English father label
  'স্বামী',       // husband label (replaces father for female holders)
  'husband',      // English husband label
  'মাতা',         // mother label
  'mother',       // English mother label
  'date of birth',
  'date of b',
  'dob',
  'জন্ম তারিখ',
  'id no',
  'nid no',
];

/**
 * Tokens indicating the BACK side of a Bangladesh NID.
 * Match is case-insensitive. MRZ lines are caught separately.
 */
const BACK_KEYWORDS = [
  'ঠিকানা',           // address label
  'address',          // English address label
  'blood group',
  'রক্তের গ্রুপ',
  'issue date',
  'প্রদানের তারিখ',
  'place of birth',
  'বৈধতার মেয়াদ',    // validity (temporary NID)
  'valid until',
];

/**
 * MRZ lines look like `I<BGD...` or `P<BGD...` and only appear on the back side
 * of smart NIDs.
 */
const MRZ_REGEX = /^[IPA]<BGD/i;

/** Min hits per side required to call an image "combined". Prevents false positives. */
const MIN_HITS_PER_SIDE = 2;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CombinedDetection {
  isCombined: boolean;
  /** Y coordinate that separates front (above) from back (below). 0 if not combined. */
  splitY:     number;
  /** Diagnostic — number of keyword hits on each side. */
  frontHits:  number;
  backHits:   number;
}

// ─── Bbox helpers ─────────────────────────────────────────────────────────────

function topY(bbox: BoundingBox): number {
  return Math.min(...bbox.vertices.map(v => v.y));
}
function bottomY(bbox: BoundingBox): number {
  return Math.max(...bbox.vertices.map(v => v.y));
}
function centerY(bbox: BoundingBox): number {
  return (topY(bbox) + bottomY(bbox)) / 2;
}

// ─── Keyword matching ─────────────────────────────────────────────────────────

function lineMatchesAny(text: string, keywords: string[]): string | null {
  const lowerText = text.toLowerCase();
  for (const kw of keywords) {
    if (lowerText.includes(kw.toLowerCase())) return kw;
  }
  return null;
}

function lineIsMrz(text: string): boolean {
  return MRZ_REGEX.test(text.trim());
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Detects whether a set of CV LineRecords belongs to a single image that
 * contains BOTH the front and back of a NID card stacked vertically.
 *
 * Detection requires at least MIN_HITS_PER_SIDE distinct front-keyword matches
 * AND at least MIN_HITS_PER_SIDE distinct back-keyword/MRZ matches. This avoids
 * false positives on cards that happen to mention a single back-side word in
 * their address or footer.
 *
 * Returns the computed split-Y coordinate when detection succeeds — the
 * midpoint between the lowest front-keyword line and the highest back-keyword
 * line. If there is no vertical separation between them, falls back to the
 * mean Y of all lines in the image.
 */
export function detectCombinedSides(lines: LineRecord[]): CombinedDetection {
  const frontMatchedLines: LineRecord[] = [];
  const backMatchedLines:  LineRecord[] = [];
  const frontKeywordsHit = new Set<string>();
  const backKeywordsHit  = new Set<string>();

  for (const line of lines) {
    if (!line.boundingBox) continue;
    const text = line.text;

    const frontHit = lineMatchesAny(text, FRONT_KEYWORDS);
    if (frontHit) {
      frontKeywordsHit.add(frontHit);
      frontMatchedLines.push(line);
      continue;
    }

    const backHit = lineMatchesAny(text, BACK_KEYWORDS);
    if (backHit) {
      backKeywordsHit.add(backHit);
      backMatchedLines.push(line);
      continue;
    }

    if (lineIsMrz(text)) {
      backKeywordsHit.add('MRZ');
      backMatchedLines.push(line);
    }
  }

  const frontHits = frontKeywordsHit.size;
  const backHits  = backKeywordsHit.size;
  const isCombined = frontHits >= MIN_HITS_PER_SIDE && backHits >= MIN_HITS_PER_SIDE;

  if (!isCombined) {
    return { isCombined: false, splitY: 0, frontHits, backHits };
  }

  // Compute split Y between the lowest front-keyword line and highest back-keyword line.
  const maxFrontY = Math.max(...frontMatchedLines.map(l => bottomY(l.boundingBox!)));
  const minBackY  = Math.min(...backMatchedLines.map(l => topY(l.boundingBox!)));

  let splitY: number;
  if (minBackY > maxFrontY) {
    splitY = (maxFrontY + minBackY) / 2;
  } else {
    // Overlapping zones (rare — angled photos). Fall back to mean Y.
    const allYs = lines
      .filter(l => l.boundingBox)
      .map(l => centerY(l.boundingBox!));
    splitY = allYs.length > 0
      ? allYs.reduce((a, b) => a + b, 0) / allYs.length
      : 0;
  }

  return { isCombined: true, splitY, frontHits, backHits };
}

// ─── Reclassification ─────────────────────────────────────────────────────────

/**
 * Reassigns the `side` attribute and rewrites `id` for each LineRecord based
 * on its center Y relative to splitY. Lines above splitY → 'front', below → 'back'.
 *
 * Original order is preserved within each side; IDs are renumbered as
 * `front_0`, `front_1`, … and `back_0`, `back_1`, …
 */
export function reclassifyLines(lines: LineRecord[], splitY: number): LineRecord[] {
  let frontIdx = 0;
  let backIdx  = 0;
  const out: LineRecord[] = [];

  for (const line of lines) {
    if (!line.boundingBox) {
      // Lines without a bbox (rare fallback path) — keep original side/id
      out.push(line);
      continue;
    }

    const cy = centerY(line.boundingBox);
    const side: LineRecord['side'] = cy < splitY ? 'front' : 'back';
    const newId = side === 'front' ? `front_${frontIdx++}` : `back_${backIdx++}`;

    out.push({
      ...line,
      side,
      id: newId,
    });
  }

  return out;
}

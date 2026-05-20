# Tier-2 Merge Fix and Gap Enhancement

**Status:** Implemented (2026-05-15) — pending validation run
**Date:** 2026-05-15
**Builds on:** `label-value-gap-detection.md`, `glare-aware-smart-mode.md`

---

## 1. Problems discovered after first gap-detection run

Running the trigger image (WhatsApp Image 2026-04-20) after gap-detection showed:

### Bug A — Tier-2 regression on non-verify fields (critical)

Tier-1 correctly extracted `fatherNameBn = "তারিক ইমতিয়াজ পাটোয়ারী"` (from the স্বামী line).
Tier-2 overwrote it with `null` because we replace the FULL extraction with Tier-2's output,
including fields Tier-2 was never asked to verify.

Root cause: in `smart.ts`, after Tier-2 parses, we do:
```typescript
const extraction = withReviewList({ ...tier2Parsed, qualityIssues: mergedIssues });
```
This replaces all Tier-1 values unconditionally.

Fix: For fields that were `action: 'pass'` in routing (never sent to Tier-2), copy Tier-1's
value back into the final result after Tier-2 returns.

### Bug B — Enhancement insufficient to reveal the partial "ৎ" character (improvement)

Visual inspection of `outputs/gap_raw.jpg` confirms:
  - After `মাতা:` there is a circular flash-glare blob
  - Immediately to the RIGHT of the glare, the character "ৎ" (khanda ta) is VISIBLE
  - This is the final character of the obliterated prefix word (most likely "মোসাম্মাৎ")
  - "আরা বেগম" follows clearly

The current production enhancement (`clahe({width:50,height:50}) + normalise`) uses tiles
too large relative to the narrow glare strip (~26 px tall, ~120 px wide). A 50-px tile spans
the entire height twice, averaging-out exactly the signal we want to preserve.

Fix: Use smaller CLAHE tiles (20×20) + gamma pull-down + normalise for gap-detected crops.
Also send the NEGATED variant (dark blob, strokes become high-contrast) — `gap_negate.jpg`
clearly shows the ৎ character edge where the raw crop shows white.

---

## 2. Detailed implementation

### Phase 1 — Merge fix (Bug A)

**File:** `src/strategies/smart.ts`

Track which field keys were in `verify` before the Tier-2 call:

```typescript
const verifyFieldSet = new Set(verify.map(d => d.field));
```

After Tier-2 parse, merge Tier-1's pass values back:

```typescript
const NID_FIELD_KEYS_TYPED: ReadonlyArray<keyof NidResult> = [
  'nidNumber','nameEn','nameBn','dateOfBirth','fatherNameBn','motherNameBn',
  'addressBn','bloodGroup','issueDate','placeOfBirth','validUntil',
];

let finalExtraction = { ...tier2Parsed };
if (tier1) {
  for (const field of NID_FIELD_KEYS_TYPED) {
    if (!verifyFieldSet.has(field as NidFieldKey)) {
      // Not sent for verification — preserve Tier-1's reading
      (finalExtraction as Record<string, unknown>)[field] = tier1.extraction[field];
    }
  }
}
const extraction = withReviewList({ ...finalExtraction, qualityIssues: mergedIssues });
```

This ensures:
- Verify fields: use Tier-2's output (it had the image context)
- Pass fields:   use Tier-1's output (already validated, don't let Tier-2 regress)

### Phase 2 — Stronger gap-crop enhancement (Bug B)

**File:** `src/utils/imageEnhance.ts`

Add a second export for the narrow-glare case:

```typescript
/**
 * More aggressive enhancement for gap-detected crops where the glare
 * is a narrow strip (26-40 px tall). Smaller CLAHE tiles (20 px) prevent
 * averaging across the strip height, gamma pulls bright midtones toward
 * mid-grey to reveal surviving letter strokes.
 */
export async function enhanceForGapRecovery(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .clahe({ width: 20, height: 20, maxSlope: 5 })
    .gamma(2.4)
    .normalise()
    .jpeg({ quality: 95 })
    .toBuffer();
}

/**
 * Negation + normalise: makes the bright glare area dark so surviving
 * letter strokes (which were darker than the glare) become bright/visible.
 * Particularly effective for revealing the final character at the right
 * edge of a glare zone (e.g. "ৎ" of "মোসাম্মাৎ").
 */
export async function enhanceNegatedForGap(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .negate()
    .normalise()
    .jpeg({ quality: 95 })
    .toBuffer();
}
```

**File:** `src/strategies/smart.ts` — gap-detected crop path

Instead of a single CLAHE-50 crop, send THREE variants to Tier-2:
1. Raw crop (original source, no processing) — baseline
2. Aggressive CLAHE (20×20 + gamma) — pulls partial strokes out of the bright zone
3. Negated (glare → dark, strokes → bright) — makes the right-edge ৎ character legible

```typescript
// In the gap-detected path:
const [rawCrop, aggressiveCrop, negatedCrop] = await Promise.all([
  cropImageByBox(image.buffer, gapReport.fullCropBbox, 0.15),
  cropImageByBox(await enhanceForGapRecovery(image.buffer), gapReport.fullCropBbox, 0.15),
  cropImageByBox(await enhanceNegatedForGap(image.buffer), gapReport.fullCropBbox, 0.15),
]);
```

Upload all three and include as a sequence in Tier-2's input, with descriptive labels so
the model knows each variant's purpose.

### Phase 3 — Tier-2 prompt: specific ৎ guidance

**File:** `src/prompts/smartTier2.ts` — update the GAP-DETECTED FIELDS section

Add explicit guidance about the partial-character at the glare edge:

```
  - Three crop variants are provided for each [GAP DETECTED] field:
      RAW          — original, unprocessed
      AGGRESSIVE   — CLAHE+gamma; partial strokes inside glare zone amplified
      NEGATED      — glare becomes dark; surviving strokes become bright/light
  - Look for character remnants at the RIGHT edge of the glare zone.
    Bangladeshi mother names often end with "মোসাম্মাৎ" (ending in ৎ) before
    the given name. The "ৎ" character may be partially visible at the glare's
    right margin — look for it in the NEGATED and AGGRESSIVE variants.
  - If you can identify even 1–2 characters, attempt reconstruction using
    BANGLA RULES and common NID name patterns. Return confidence:"low".
```

### Phase 4 — স্বামী → fatherNameBn mapping in shared prompt

**File:** `src/prompts/shared/nidFormat.ts`

Ensure both label variants map to the same field:

```
NOTE: For female card holders, "স্বামী" (husband) replaces "পিতা" (father)
in the fatherNameBn field. Always map স্বামী: value → fatherNameBn.
```

---

## 3. Order of work

1. Phase 1 — Merge fix (quick, eliminates the regression)
2. Phase 2 — New enhancement functions + update smart.ts gap path
3. Phase 3 — Tier-2 prompt update
4. Phase 4 — nidFormat.ts স্বামী mapping note
5. Update plan status + CLAUDE.md

---

## 4. Expected result after fix

```
fatherNameBn: "তারিক ইমতিয়াজ পাটোয়ারী"   ← restored from Tier-1 (no more regression)
motherNameBn:
  value: "মোসাম্মাৎ আরা বেগম"  (if model reconstructs ৎ prefix)
  OR
  value: "? আরা বেগম" / "ৎ আরা বেগম"       (partial, at least with the ৎ)
  confidence: "low", needsReview: true
  qualityIssues: ["gap_motherNameBn", "glare_motherNameBn"]
```

The reconstruction depends on whether the model can see the ৎ character in the
negated/aggressive variants. Visual inspection confirms it is present.

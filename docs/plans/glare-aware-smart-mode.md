# Glare-Aware Smart Mode

**Status:** Implemented (2026-05-15) — pending validation against trigger image
**Date:** 2026-05-15
**Trigger image:** `nid_images/nid_images/WhatsApp Image 2026-04-20 at 2.19.09 PM.jpeg` — flash glare washes out the mother's name region; both Cloud Vision OCR and the model's vision read it as "absent."

---

## 1. Problem statement

When part of a NID card is over-exposed by camera flash (or blurred, occluded, glared by lamination), the affected text region is read as empty by both Cloud Vision and Gemini's vision. The current smart pipeline then classifies the field as "not present on this side" and skips visual verification entirely — so the missing data is silently dropped instead of recovered or flagged.

Two failure modes compound:

1. **Routing blind spot.** `routeSmartFields` in `src/utils/fieldValidators.ts` treats any field with `value: null, needsReview: false` as `action: 'absent'`. This conflates:
   - Genuinely-absent fields (e.g. `placeOfBirth` on a laminated card)
   - Fields that *should* be present on the provided side but were obscured by capture issues

2. **No capture-quality signal.** Even when CV detects glare regions, the pipeline doesn't act on that signal — no enhancement, no re-OCR, no warning to the caller.

## 2. Goals

- Recover field values that are obscured by flash glare, when recovery is feasible.
- Flag fields that remain unrecoverable so the API consumer can prompt the user to re-upload.
- Add minimal Pro-model token cost — only run enhanced re-OCR when there is real evidence of capture issues.

## 3. Out of scope

- Generic photo restoration / deblur. We only target the glare-recovery case.
- Front/back MRZ cross-decoding for smart NIDs (could be a future enhancement).
- Real-time client-side capture guidance.

## 4. Design overview

The fix has two independent halves that compose well:

**Half A — Distrust "absent" fields.** Use the existing per-variant, per-side field layout knowledge to decide whether a missing field is genuinely-absent or expected-but-missing. Route the latter to Tier-2 instead of dropping it.

**Half B — Detect and recover glare regions.** Run a lightweight luminance scan on each image. If glare is detected, send a CLAHE-enhanced copy of the side (or crop) to Tier-2 alongside the original so the model can read recovered detail.

Together: a flash-affected field gets routed to Tier-2 (instead of being marked absent) AND Tier-2 receives an enhanced image (instead of the same blown-out copy).

## 5. Detailed implementation

### Phase 1 — Routing fix (Half A)

**File:** `src/utils/fieldValidators.ts`

Replace the current `action: 'absent'` branch with a per-side expectation check.

Add helper:

```ts
// fieldLayout.ts (new) or inline in fieldValidators.ts
const FRONT_FIELDS: NidFieldKey[]    = ['nidNumber','nameEn','nameBn','dateOfBirth','fatherNameBn','motherNameBn'];
const BACK_FIELDS:  NidFieldKey[]    = ['addressBn','bloodGroup','issueDate'];
const SMART_BACK_ONLY: NidFieldKey[] = ['placeOfBirth'];
const TEMP_ONLY: NidFieldKey[]       = ['validUntil'];

function isFieldExpectedOnSides(
  field: NidFieldKey,
  providedSides: Set<NidImage['side']>,
  cardType: NidResult['cardType'],
): boolean {
  if (FRONT_FIELDS.includes(field)) return providedSides.has('front');
  if (BACK_FIELDS.includes(field))  return providedSides.has('back');
  if (SMART_BACK_ONLY.includes(field)) return providedSides.has('back') && cardType === 'smart';
  if (TEMP_ONLY.includes(field))       return cardType === 'temporary';
  return false;
}
```

Update `routeSmartFields` signature to accept `providedSides`:

```ts
export function routeSmartFields(
  tier1: Tier1SmartResult,
  cvConfidenceThreshold: number,
  providedSides: Set<NidImage['side']>,
): SmartRoutingDecision[] {
  ...
  if (!fieldResult.value && !fieldResult.needsReview) {
    if (isFieldExpectedOnSides(field, providedSides, tier1.extraction.cardType)) {
      return {
        field,
        action: 'verify',
        reason: 'expected_field_missing_from_ocr',
        source,
      };
    }
    return { field, action: 'absent', reason: 'not expected on provided side(s)', source };
  }
  ...
}
```

Update caller in `src/strategies/smart.ts` to pass the provided sides set.

**LOC:** ~40

### Phase 2 — Glare detection (Half B, part 1)

**New file:** `src/utils/glareDetection.ts`

```ts
import sharp from 'sharp';
import type { BoundingBox } from '../core/smartTypes.js';

export interface GlareReport {
  regions:  BoundingBox[]; // bounding boxes in original image coordinates
  coverage: number;        // fraction of image affected (0–1)
}

const CELL_SIZE = 32;          // analyze in 32x32 image-coordinate cells
const LUM_THRESHOLD = 240;     // saturated pixel cutoff (0-255)
const FLAT_VAR_MAX = 50;       // variance below this → flat region (no text)

export async function detectGlare(buffer: Buffer): Promise<GlareReport> {
  // 1. Get image metadata for original dimensions
  const meta = await sharp(buffer).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;

  // 2. Downsample to a small luminance map (for speed)
  const cellsX = Math.ceil(W / CELL_SIZE);
  const cellsY = Math.ceil(H / CELL_SIZE);
  const { data } = await sharp(buffer)
    .grayscale()
    .resize(cellsX, cellsY, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 3. Flag cells that are saturated + flat
  const flagged: boolean[] = new Array(cellsX * cellsY).fill(false);
  for (let i = 0; i < data.length; i++) {
    if (data[i] >= LUM_THRESHOLD) flagged[i] = true;
  }
  // Variance filter: optional second pass using local 3x3 variance on the downsampled map
  // (Skipped in v1 for simplicity — high luminance alone is a strong glare signal on NID cards.)

  // 4. Merge adjacent flagged cells into bounding boxes (flood fill on grid)
  const regions = mergeCellsToBBoxes(flagged, cellsX, cellsY, CELL_SIZE, W, H);
  const flaggedCount = flagged.filter(Boolean).length;
  const coverage = flaggedCount / (cellsX * cellsY);
  return { regions, coverage };
}

function mergeCellsToBBoxes(...) { /* simple connected-component scan */ }
```

**LOC:** ~80

### Phase 3 — Image enhancement (Half B, part 2)

**New file:** `src/utils/imageEnhance.ts`

```ts
import sharp from 'sharp';

/**
 * CLAHE (Contrast-Limited Adaptive Histogram Equalization) recovers detail
 * from over-exposed regions. Good for flash glare on NID cards.
 *
 * Tile size ≈ 50px works well for NID-scale fields. maxSlope=3 prevents
 * extreme amplification of noise in already-flat regions.
 */
export async function enhanceForGlareRecovery(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .clahe({ width: 50, height: 50, maxSlope: 3 })
    .normalise()
    .jpeg({ quality: 92 })
    .toBuffer();
}
```

**LOC:** ~15

### Phase 4 — Smart strategy wiring

**File:** `src/strategies/smart.ts`

After Cloud Vision rich (Phase 0 in the existing pipeline), add:

```ts
const glareReports = await Promise.all(
  images.map(async (img) => {
    const stop = timer.start(`glare_${img.side}`);
    const report = await detectGlare(img.buffer);
    stop();
    return { side: img.side, report };
  }),
);
const glareBySide = new Map(glareReports.map(r => [r.side, r.report]));
```

Pass `providedSides` to `routeSmartFields`:

```ts
const providedSides = new Set(images.map(img => img.side));
const routing = tier1
  ? routeSmartFields(tier1, config.smart.cvConfidenceThreshold, providedSides)
  : ...
```

For each `verify` decision, decide whether to enhance the crop/image:

```ts
function shouldEnhanceForField(
  decision: SmartRoutingDecision,
  glareBySide: Map<string, GlareReport>,
): boolean {
  const report = glareBySide.get(decision.source?.side ?? 'unknown');
  if (!report) return false;
  if (report.coverage > 0.05) return true;   // any meaningful glare on this side
  // TODO: spatial overlap check between field bbox and glare regions
  return false;
}
```

When enhancing:

```ts
const sourceBuf = shouldEnhanceForField(decision, glareBySide)
  ? await enhanceForGlareRecovery(image.buffer)
  : image.buffer;
const crop = await cropImageByBox(sourceBuf, box);
```

For absent-but-expected fields (no source bbox), upload an enhanced version of the full side image and add it to the Tier-2 input:

```ts
const enhancedUris: string[] = [];
for (const decision of verify) {
  if (!decision.source) {
    // No bbox known — provide enhanced full side as fallback
    const side = providedSideForField(decision.field); // front or back
    const img = images.find(i => i.side === side);
    if (img && glareBySide.get(side)?.coverage > 0.02) {
      const enhanced = await enhanceForGlareRecovery(img.buffer);
      const uri = await uploadToFilesApi(enhanced, 'image/jpeg');
      enhancedUris.push(uri);
      uploadedUris.push(uri);
    }
  }
}
```

Include these in the Tier-2 prompt as `[ENHANCED] {side}`.

**LOC:** ~60

### Phase 5 — API surface

**Files:** `src/core/models.ts`, `src/api/openapi.ts`, `src/utils/nidSchema.ts`

Add `qualityIssues: string[]` to `NidResultSchema`:

```ts
export const NidResultSchema = z.object({
  cardType: ...,
  // ... existing fields ...
  overallConfidence: ...,
  fieldsNeedingReview: z.array(z.string()),
  qualityIssues: z.array(z.string()).default([]),  // NEW
});
```

Populated by the smart strategy when glare is detected. Format: `'glare_<field>'` (e.g. `'glare_motherNameBn'`).

Update OpenAPI spec to document the field as a hint for clients to suggest re-upload.

Update `NID_JSON_SCHEMA` to allow the field but not require it (other strategies leave it empty).

**LOC:** ~25

### Phase 6 — Tier-2 prompt update

**File:** `src/prompts/smartTier2.ts`

Add a section:

```
════════════════════════════════════════
GLARE / CAPTURE RECOVERY
════════════════════════════════════════
Some inputs may include an ENHANCED variant labelled "[ENHANCED] <side>".
These have been CLAHE-processed to recover detail from over-exposed (flash)
or low-contrast regions. The enhanced image may show partial Bengali strokes
that were invisible in the original.

Recovery rules:
  - If a field is missing in the original but partially visible in the enhanced
    version, attempt reconstruction using BANGLA RULES and mark confidence:"low",
    needsReview:true.
  - If neither original nor enhanced shows the field, return value:null,
    confidence:"unreadable", needsReview:true (NOT needsReview:false — the field
    was expected but capture was insufficient).
  - Add an entry like "glare_motherNameBn" to qualityIssues when you can tell
    the field was lost to over-exposure rather than genuinely absent.
```

**LOC:** ~30

### Phase 7 — Documentation

- Update `CLAUDE.md` — add `glareDetection.ts`, `imageEnhance.ts` to utils list; add `qualityIssues` to NID Field Layout section.
- Update `src/api/openapi.ts` example payload to include `qualityIssues`.
- Update `docs/plans/glare-aware-smart-mode.md` (this file) — set status to "Implemented" with date.

## 6. Order of work

1. **Phase 1** (routing fix) — standalone win, recovers most cases by simply running Tier-2 on missing fields.
2. **Phase 5** (API surface) — add `qualityIssues` field so Phase 4 can populate it.
3. **Phase 3** (enhancement util) — pure function, easy.
4. **Phase 2** (glare detection) — pure function, can be tested in isolation against the trigger image.
5. **Phase 4** (wiring) — depends on 1–3.
6. **Phase 6** (prompt) — update once we know the input shape.
7. **Phase 7** (docs) — last.

## 7. Validation

- Re-run the trigger image (`WhatsApp Image 2026-04-20 at 2.19.09 PM.jpeg`) in smart mode. Expect:
  - `glareReports['front'].coverage > 0` (some glare detected)
  - `motherNameBn` routed to `verify`, not `absent`
  - Tier-2 receives an enhanced front-side image
  - Final `motherNameBn.value` is non-null (recovered) OR `qualityIssues` contains `'glare_motherNameBn'`
- Run `scripts/runOne.ts --mode smart --front <trigger-image>` and inspect output JSON.
- Run against a glare-free image to confirm Phase 4 doesn't run the enhancement path needlessly.

## 8. Tradeoffs

- More Tier-2 invocations → more Pro-model tokens. Mitigated because most images have all fields filled, so missing-field-triggered Tier-2 is rare.
- CLAHE on a 3MB JPEG adds ~150–300 ms. Only applied when glare detected.
- Glare detection has false positives on highly reflective laminate. The 5% coverage threshold and the per-field overlap check (Phase 4 TODO) reduce this.
- Adding `qualityIssues` is a non-breaking schema change (optional with default).

## 9. Future enhancements (not in scope)

- Per-field spatial overlap check (TODO in Phase 4) — compare field bbox to glare regions.
- Multi-exposure ensemble: send both original and enhanced crops side-by-side for every verify field.
- Front/back cross-reference: extract name from smart NID MRZ when front is glared.
- Client-side capture quality feedback before upload.

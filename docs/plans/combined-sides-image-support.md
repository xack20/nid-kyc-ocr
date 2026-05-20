# Combined-Sides Image Support in Smart Mode

**Status:** Implemented (2026-05-20) — pending validation against trigger image
**Date:** 2026-05-20

---

## 1. Problem

A user uploads a single image containing BOTH the front and back of a Bangladesh
NID stacked vertically — common when the card is photographed lying flat or when
the back side is glued/printed below the front for an electronic version. The
example image shows a smart NID with the chip + holder photo on top half, and
the barcode + address + blood group + MRZ on the bottom half.

Current behavior of smart mode on such an image:

- `runOne.ts --front <combined-image>` → produces one `NidImage` with `side: 'front'`
- CV runs and extracts ALL text (both front and back fields together)
- Tier-1 sees the combined OCR text and extracts what it can — this usually works
  because the text is all there
- **But the routing logic** uses `isFieldExpectedOnSides(field, providedSides={'front'})`:
  - Back-side fields (`addressBn`, `bloodGroup`, `issueDate`, `placeOfBirth`) are NOT
    "expected" given `providedSides = {'front'}`
  - If Tier-1 missed any of them → they are marked `action: 'absent'` instead of
    `action: 'verify'`
  - Gap detection on back-side label-only lines wouldn't trigger field-promotion
    because the field is "not expected"
  - Field-bbox cropping for back-side fields tries to look up
    `images.find(img => img.side === 'back')` — fails, returns undefined
- Result: back-side fields work *by accident* when Tier-1 succeeds, fail silently
  when it doesn't, and no verification pass is performed for them.

## 2. Goals

- Auto-detect when a single uploaded image contains both sides
- Treat such an image as if both `front` and `back` were provided
- Keep the existing two-image flow (front + back separately) unchanged
- No extra Cloud Vision calls
- No extra Files API uploads
- No extra Gemini calls

## 3. Approach: logical split (not physical split)

Rather than physically slicing the image with sharp into two buffers, we:

1. Run CV once on the original combined image
2. Analyze the CV `LineRecord[]` for both-side keyword indicators
3. If detected, reclassify each line's `side` attribute based on its Y coordinate
4. Mark the `NidImage` itself as `side: 'combined'` (new side type)
5. Tell the routing system `providedSides = {'front', 'back'}`
6. Add a lookup helper so back-side bbox crops fall back to the combined image

**Why logical, not physical:** the image is already one CV pass and one upload.
Splitting it would double the CV cost and Files API cost with no accuracy benefit
because bounding boxes are in absolute coordinates of the original image —
cropping by bbox works correctly against the combined buffer.

## 4. Detection signal

After CV runs and produces `LineRecord[]`:

**Front-side keywords (any line text contains):**
- `নাম`, `পিতা`, `স্বামী`, `মাতা`
- `Date of Birth`, `Date of B`, `জন্ম তারিখ`
- `ID NO`, `NID No`

**Back-side keywords (any line text contains):**
- `ঠিকানা`, `Address`
- `Blood Group`, `রক্তের গ্রুপ`
- `Issue Date`, `প্রদানের তারিখ`
- `Place of Birth`
- MRZ pattern: a line matching `/^[IPA]<BGD/`

**Detection rule:**
- At least 2 distinct front-side keyword hits
- AND at least 2 distinct back-side keyword hits
- AND the image was passed in with `side: 'front'` or `side: 'unknown'` (we don't
  re-classify if the user explicitly said it's a back-only image)

If both conditions match → combined-image detected.

The "at least 2 of each" rule avoids false positives (e.g., a front-only image
that happens to mention "Issue" once in an unrelated context).

## 5. Split Y computation

After detection, compute where to draw the line between front and back:

1. Find max Y (bottom edge) of any line containing a front keyword → `maxFrontY`
2. Find min Y (top edge) of any line containing a back keyword → `minBackY`
3. If `minBackY > maxFrontY` (clean vertical separation):
   `splitY = (maxFrontY + minBackY) / 2`
4. If they overlap (rare, e.g. card photographed at an angle):
   `splitY = imageHeight / 2` as fallback

## 6. Line reclassification

For each `LineRecord` in the combined image:
- Compute `centerY = (top + bottom) / 2` from its bounding box
- If `centerY < splitY` → reassign `line.side = 'front'`
- Else → reassign `line.side = 'back'`
- Reassign line IDs sequentially: `front_0`, `front_1`, … / `back_0`, `back_1`, …
- Preserve original `confidence` and `boundingBox` (already in absolute image coords)

## 7. NidImage `side` reassignment

Add `'combined'` as a new value to the `NidImage.side` union type:

```ts
side: 'front' | 'back' | 'unknown' | 'combined'
```

When detection triggers, mutate the NidImage's side to `'combined'`.

## 8. providedSides update

The smart strategy currently computes:
```ts
const providedSides = new Set(images.map(img => img.side));
```

After this change, if any image has `side: 'combined'`, the strategy expands the
set to include both `'front'` and `'back'`:

```ts
const providedSides = new Set<NidImage['side']>();
for (const img of images) {
  if (img.side === 'combined') {
    providedSides.add('front');
    providedSides.add('back');
  } else {
    providedSides.add(img.side);
  }
}
```

This ensures `isFieldExpectedOnSides('addressBn', {front, back}, 'smart')` returns
true → back-side fields get routed to `verify` instead of `absent` when Tier-1
misses them.

## 9. Image-lookup helper

Multiple places in `smart.ts` do `images.find(img => img.side === X)`. Replace
these with a helper:

```ts
function findImageForSide(images: NidImage[], side: NidImage['side']): NidImage | undefined {
  return images.find(img => img.side === side)
      ?? images.find(img => img.side === 'combined');
}
```

This makes back-side bbox crops fall back to the combined image buffer when no
dedicated back-side image is present.

## 10. Files changed

| File | Change |
|---|---|
| `src/core/types.ts` | Add `'combined'` to `NidImage.side` union |
| `src/utils/sideClassification.ts` (new) | `detectCombinedSides()`, `reclassifyLines()` |
| `src/strategies/smart.ts` | Call detection after CV; expand `providedSides`; use lookup helper |
| `src/api/openapi.ts` | Document combined-side support for `front` field |
| `CLAUDE.md` | Mention combined-side handling in smart mode |

## 11. What doesn't change

- Two separate images (front + back) → unchanged pipeline
- A genuinely front-only image → detection won't trigger (no back keywords)
- A genuinely back-only image → detection won't trigger (no front keywords)
- Other extraction modes (gemini_only, combined, vision_only, etc.) — out of scope
- Tier-1 prompt — unchanged (it sees all the lines either way)
- Tier-2 prompt — unchanged

## 12. Risks and mitigations

- **False positive detection** (front-only image flagged as combined): mitigated by
  the "at least 2 of each side's keywords" rule
- **False negative detection** (combined image not flagged): minor — the pipeline
  degrades to current behavior (some back fields silent failures)
- **Bounding-box-only cropping precision**: unchanged — bboxes are absolute
  coordinates, cropping a back-field bbox from the combined image gives the
  correct region

## 13. Validation

Run smart mode on the example combined-sides image (MD RUHUL AMIN smart NID,
1024×1267). Expected output:
- `cardType: 'smart'`
- `nidNumber.value: '3268483744'` (10-digit smart NID, spaces stripped)
- `nameEn.value: 'MD. RUHUL AMIN'`
- `nameBn.value: 'মোঃ রুহুল আমিন'`
- `dateOfBirth.value: '21 Jan 1986'` (or similar)
- `fatherNameBn.value: 'জকরাত আলী'` (or similar)
- `motherNameBn.value: 'মোছাঃ বাহিয়া খাতুন'`
- `addressBn.value` populated (long address)
- `bloodGroup.value: 'AB+'`
- `placeOfBirth.value: 'JHENAIDAH'`
- `issueDate.value: '30 Nov 2015'`
- `validUntil.value: null` (not a temporary NID)
- `overallConfidence: 'high'` or `'medium'`
- `fieldsNeedingReview: []` or minimal

And `visionOutputs[0].side: 'combined'` in the response.

## 14. Order of work

1. Add `'combined'` to side type in `core/types.ts`
2. Create `src/utils/sideClassification.ts` with detection + reclassification
3. Wire into `smart.ts` after the CV pass
4. Replace direct `images.find(img => img.side === X)` calls with the helper
5. Update OpenAPI doc
6. Update CLAUDE.md
7. Run validation against the example image

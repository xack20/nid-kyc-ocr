# Label-Value Gap Detection

**Status:** Implemented (2026-05-15) — pending validation against trigger image
**Date:** 2026-05-15
**Builds on:** `glare-aware-smart-mode.md`

---

## 1. Problem

When a NID card is photographed with camera flash, the light can wipe out one
or more words in a field. Cloud Vision detects the surviving text with high
confidence — because those characters ARE clear — but never sees the obliterated
prefix. Tier-1 faithfully extracts the partial value ("আরা বেগম") at high
confidence and routing marks it PASS. Tier-2 is never invoked.

Neither glare-detection thresholds nor semantic value-length heuristics catch
this reliably. The real evidence is **spatial**: the gap between a field's label
and its first detectable value word is 3× wider than every other label on the
same card.

## 2. Key observation (from live CV inspection)

```
inspectVision output — WhatsApp Image 2026-04-20 at 2.19.09 PM.jpeg

Block 2: "নাম : ইফফাত আরা বেগম"          x=363→701  (one block, normal gap ~39px)
Block 5: "স্বামী : তারিক ইমতিয়াজ পাটোয়ারী"  x=359→784  (one block, normal gap ~35px)

Block 6: "মাতা :"      x=358→424   ← label ONLY
Block 7: "আরা বেগম"    x=542→673   ← value ONLY, same Y-row, gap=118px
```

Cloud Vision splits the label and value into **separate blocks** when the gap
exceeds normal word-spacing. This split is itself the anomaly signal — when a
label and its value sit on the same Y-row but in different blocks with a large
horizontal gap, text is missing between them.

Our `extractRichVisionLines` already produces one `LineRecord` per CV paragraph
(one per block in single-paragraph blocks). So the existing `LineRecord[]` is
sufficient — no changes to `vision.ts` needed.

## 3. Approach

**Block-split gap detection:** for each `LineRecord` that contains only a label
keyword, search for a peer `LineRecord` on the same Y-row to the right. If the
horizontal gap exceeds 80 px (empirical threshold: normal is 35–40 px, anomalous
is 118 px), mark that field as gap-suspect and force it to Tier-2 verify.

Crop for Tier-2 = union of (label bbox + gap area + value bbox) + CLAHE
enhancement, so the model has the maximum visual context to reconstruct partial
letters.

## 4. Detailed implementation

### 4.1 New file — `src/utils/gapDetection.ts`

```
INLINE_LABELS catalog:
  { keyword: 'মাতা',   field: 'motherNameBn' }
  { keyword: 'পিতা',   field: 'fatherNameBn' }
  { keyword: 'স্বামী', field: 'fatherNameBn' }
  { keyword: 'নাম',    field: 'nameBn' }
  { keyword: 'ID NO',  field: 'nidNumber' }
  { keyword: 'NID No', field: 'nidNumber' }

(Stacked-layout labels like "Name:", "Date of B.", "Issue Date" are excluded —
their values intentionally appear on the next row, not the same row.)
```

`isLabelOnlyLine(text, keyword) → boolean`
  — text starts with keyword; after stripping keyword + colon + whitespace,
    nothing meaningful remains.

`detectLabelValueGaps(lines: LineRecord[]) → GapReport[]`
  Algorithm per label-matching line:
  1. Compute label's right-edge X and center Y.
  2. Find all other lines where:
       |otherCenterY − labelCenterY| ≤ lineHeight × 0.7  (same row)
       AND otherLeft > labelRight                          (to the right)
       AND otherLeft − labelRight ≤ 500                   (not across the full page)
  3. Take the closest such line (smallest X-distance).
  4. Compute gap = closestLeft − labelRight.
  5. If gap > 80 px → emit GapReport { field, side, labelBbox, valueBbox, fullCropBbox, gapPx }
     fullCropBbox = mergeBoundingBoxes([labelBbox, valueBbox])

```typescript
export interface GapReport {
  field:        NidFieldKey;
  side:         NidImage['side'];
  labelBbox:    BoundingBox;
  valueBbox:    BoundingBox | null;
  fullCropBbox: BoundingBox;
  gapPx:        number;
}
```

### 4.2 Lower glare thresholds — `src/utils/glareDetection.ts`

| Constant       | Old  | New  | Why                                           |
|----------------|------|------|-----------------------------------------------|
| LUM_CUTOFF     | 240  | 210  | JPEG compression softens peaks; 210 catches more flash |
| coverage check | 2%   | 0.5% | Flash spots can be < 1% of total image area   |

### 4.3 Smart strategy — `src/strategies/smart.ts`

After existing CV + Tier-1 phase, add:

```
gapReports = detectLabelValueGaps(allLines)
gapFieldSet = new Set(gapReports.map(r => r.field))
```

Post-routing upgrade:

```
for each decision where action === 'pass' AND field ∈ gapFieldSet:
  → upgrade to action: 'verify', reason: 'gap_detected: N px label-value gap'
```

In verify crop loop, for gap-detected fields:
  - Use `gapReport.fullCropBbox` (label + gap + value) instead of source.lineIds bbox
  - Always apply CLAHE enhancement (gap = likely flash/occlusion)
  - Tag as `"gap_<field>"` in qualityIssues
  - Annotate input to Tier-2 as `[GAP DETECTED][ENHANCED]`

### 4.4 Tier-2 prompt — `src/prompts/smartTier2.ts`

Add a `GAP-DETECTED FIELDS` section (after the GLARE section):

```
════════════════════════════════════════
GAP-DETECTED FIELDS
════════════════════════════════════════
Some crops are labelled "[GAP DETECTED][ENHANCED]".
These regions contain:
  - The field label on the left
  - A blank/bright zone in the middle (obliterated by flash or occlusion)
  - A partial value visible on the right

The blank zone likely contained 1–3 words of a Bengali name.
Apply BANGLA RULES to reconstruct as much as possible from any partially
visible strokes. Return confidence:"low", needsReview:true for reconstructed
characters. Append "gap_<fieldKey>" to qualityIssues.
```

### 4.5 CLAUDE.md update

Add `gapDetection.ts` to the utils section.

## 5. Order of work

1. `src/utils/gapDetection.ts`
2. `src/utils/glareDetection.ts` (threshold update)
3. `src/strategies/smart.ts` (wire)
4. `src/prompts/smartTier2.ts` (prompt)
5. `CLAUDE.md`

## 6. Expected behaviour on trigger image

```
Before: motherNameBn → action:pass → returned "আরা বেগম" (partial)
After:
  - detectLabelValueGaps detects Block6/Block7 gap = 118px > 80px
  - motherNameBn upgraded to action:verify
  - fullCropBbox = x:358→673, y:1033→1059 (label + gap + partial value)
  - CLAHE-enhanced crop sent to Tier-2
  - Tier-2 attempts reconstruction of missing prefix
  - Final: motherNameBn.value = recovered or partial, confidence:"low",
    needsReview:true, qualityIssues:["gap_motherNameBn"]
```

## 7. Threshold notes

| Measurement           | Value  | Source                    |
|-----------------------|--------|---------------------------|
| Normal label→value gap | 35–40 px | Observed in the trigger image |
| Anomalous gap         | 118 px | "মাতা:" case             |
| Detection threshold   | 80 px  | Midpoint with safe margin |
| Same-row Y tolerance  | 70% of line height | Handles slight skew |

## 8. Limitations

- Only catches gaps in INLINE-layout fields (same-row label + value). Stacked
  fields (Name:, Date of B.) are excluded intentionally.
- If the flash erases a tail portion (suffix missing) with no gap between label
  and partial value, this won't be caught. That case requires semantic length
  analysis (future work).
- If gap < 80 px (very small obliterated zone), won't be flagged.

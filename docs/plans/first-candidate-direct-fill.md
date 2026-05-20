# Direct Prefilling of Highest-Confidence Reconstructed Candidates

**Status:** Implemented
**Date:** 2026-05-20
**Builds on:** `suggestion-candidates-for-obliterated-fields.md`

---

## 1. Problem & Goal

Currently, for partly obliterated fields (e.g. a mother's name obscured by flash glare), the smart strategy keeps the field's `value` extremely conservative, containing only the literally legible character portion (e.g. `"ত আরা বেগম"`). The fully reconstructed options (e.g. `"জিনাত আরা বেগম"`, `"রিফাত আরা বেগম"`, `"নুসরাত আরা বেগম"`) are only offered as a list inside the top-level `suggestions` object.

While safe, this requires the reviewer to always click or select a suggestion chip to fill the field. 

**Goal:** Modify the behavior so that:
1. The **highest-confidence full reconstruction candidate** (e.g. `"জিনাত আরা বেগম"`) is placed **directly** inside the field's main `value` (e.g. `motherNameBn.value`).
2. To preserve security and signal reconstruction, the field's `confidence` is set to `"low"` and `needsReview` is set to `true`.
3. The **other three alternative candidates** (e.g. `["রিফাত আরা বেগম", "নুসরাত আরা বেগম", "মমতাজ আরা বেগম"]`) are populated in the field's `suggestions.<fieldKey>.candidates` list as options for the reviewer to easily fall back to if the first prefilled choice is incorrect.

---

## 2. Proposed Changes

We will implement this by updating the Tier-2 visual verifier instructions. No structural changes to Zod schemas or types are required, since the output JSON shapes remain identical. We will modify the prompts and documentation to define this prefilling policy clearly.

### 2.1 Prompt Modification (`src/prompts/smartTier2.ts`)

We will update two key sections in the Tier-2 prompt:

#### A. In `GAP-DETECTED FIELDS` section:
* **Current:** Tell the model to keep `value` conservative (only legible text e.g. `"ত আরা বেগম"`) and place guesses in `suggestions`.
* **New:** 
  - Instruct the model to reconstruct the full name using the anchor and gender vocabulary.
  - Place the **highest-confidence (first) full reconstruction** directly in the field's `value` (e.g. `"জিনাত আরা বেগম"`).
  - Explicitly mark `confidence: "low"` and `needsReview: true` for that field.
  - If the zone is completely unreadable with no clues, fallback to `value: null`, `confidence: "unreadable"`, `needsReview: true`.

#### B. In `Producing suggestions for [GAP DETECTED] fields` section:
* **Current:** `suggestions.<fieldKey>.candidates` contains all 1–3 reconstructions.
* **New:**
  - `suggestions.<fieldKey>.candidates` must contain up to **three other alternative full reconstructions** (excluding the first candidate already placed in the field's `value`).
  - E.g. If candidates are `["জিনাত আরা বেগম", "রিফাত আরা বেগম", "নুসরাত আরা বেগম", "মমতাজ আরা বেগম"]`, then `"জিনাত আরা বেগম"` goes directly in `motherNameBn.value`, and `["রিফাত আরা বেগম", "নুসরাত আরা বেগম", "মমতাজ আরা বেগম"]` goes in `suggestions.motherNameBn.candidates`.

### 2.2 Schema & Model Documentation (`src/prompts/shared/outputSchema.ts`, `src/api/openapi.ts`)

We will update the comments and descriptions in:
* `src/prompts/shared/outputSchema.ts` (model-facing comments)
* `src/api/openapi.ts` (developer-facing documentation and JSON example payloads)
* `CLAUDE.md`

---

## 3. Implementation Steps

1. **Write Plan:** Create `docs/plans/first-candidate-direct-fill.md` (this file).
2. **Obtain Approval:** Wait for the user's explicit approval.
3. **Update Prompts:** Modify `src/prompts/smartTier2.ts` to instruct the model on the prefilling and alternative candidate separation.
4. **Update Shared Schema Description:** Update `src/prompts/shared/outputSchema.ts`.
5. **Update API Docs:** Modify `src/api/openapi.ts` examples and text.
6. **Verify and Run:** Test extraction against the glare-affected image (`WhatsApp Image 2026-04-20 at 2.19.09 PM.jpeg`) to confirm that `motherNameBn.value` is directly prefilled with the first candidate, and the other three candidates reside in `suggestions`.

---

## 4. Verification Plan

### Manual Verification
Execute:
```bash
npm run extract -- --front "nid_images/nid_images/WhatsApp Image 2026-04-20 at 2.19.09 PM.jpeg" --mode smart
```
Verify that:
* `motherNameBn.value` is **directly filled** with the highest-confidence full name (e.g. `"জিনাত আরা বেগম"` or `"রিফাত আরা বেগম"`).
* `motherNameBn.confidence` is `"low"`.
* `motherNameBn.needsReview` is `true`.
* `suggestions.motherNameBn.candidates` contains up to **3 alternative names** (e.g. the other three suggestions).

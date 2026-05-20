# Suggestion Candidates for Obliterated Field Reconstruction

**Status:** Implemented and validated (2026-05-20)
**Date:** 2026-05-20
**Builds on:** `bengali-name-gender-aware-reconstruction.md`, `simplify-gap-reconstruction-prompt.md`

---

## 1. Problem

When a field is partly obliterated (e.g. mother's name with a flash-glare gap),
the current pipeline returns only the legible portion as the `value` —
e.g. `"ত আরা বেগম"`. The reviewer sees this and must manually research and
type the full name.

The model has more information than it surfaces: it can see the trailing
"ত" character, it can estimate the obliterated word's length from the gap
width, and it has a female-name vocabulary it can cross-reference. By
publishing 2–3 candidate full reconstructions for the human to choose from,
KYC review becomes a click instead of a research task.

## 2. Goal

When Tier-2 reconstructs a [GAP DETECTED] field, in addition to the
conservative `value` (visible portion only), emit a `suggestions` entry with:
- `estimatedLength` — model's estimate of how many Bengali character clusters
  were in the obliterated word
- `partialVisible` — what the model can actually see at the boundary
  (e.g. "ত at right edge of dark zone")
- `candidates` — 2–3 plausible full-value reconstructions for the reviewer
  to choose from

The reviewer's UI can render `candidates` as clickable chips that fill the
field on click.

## 3. Design

### 3.1 Output schema change

Add a top-level `suggestions` field to `NidResult`. It is a record keyed
by field name (only fields with active suggestions appear). Each entry has:

```ts
{
  estimatedLength: number,       // integer, >= 0
  partialVisible:  string,       // short human description (e.g. "ৎ at right edge")
  candidates:      string[],     // up to 3 full reconstructions
}
```

`value` for the affected field stays conservative — only the visible portion.
The reviewer chooses one of the candidates OR types a custom value.

### 3.2 Why a separate top-level field, not inside FieldResult

- `FieldResult` is widely consumed by callers; we don't want to add optional
  fields that break their existing parsing
- `suggestions` is opt-in: clients that don't know about it ignore it entirely
- Easier to render as a separate UI area below the form field

### 3.3 What populates this

Only `smart` mode populates `suggestions` — and only for [GAP DETECTED]
fields where Tier-2 can identify enough partial-stroke evidence.
Other modes leave `suggestions` as `{}`.

## 4. Safety rules

The model must follow these constraints to prevent hallucination:

1. **Anchor required**: every candidate must include the visible anchor
   character(s) at the correct position. If the visible boundary character
   is "ত", every candidate's obliterated portion must end in "ত".
2. **Length match**: each candidate's obliterated portion length must equal
   `estimatedLength ± 1`.
3. **Vocabulary match**: each candidate's obliterated portion must be a
   name from the gender-appropriate vocabulary (see existing
   BENGALI NAME GENDER PATTERNS section).
4. **Max 3 candidates** per field.
5. **No suggestions for the holder's own name**: never include candidates
   for `nameEn` or `nameBn` of the card holder via suggestions.
6. **Skip when uncertain**: if the model cannot estimate length or cannot
   identify any anchor character, OMIT the suggestions entry for that
   field. Do not emit an entry with empty candidates.

## 5. Files to change

| File | Change |
|---|---|
| `src/core/models.ts` | Add `SuggestionEntrySchema` and `suggestions` field to `NidResultSchema` |
| `src/utils/nidSchema.ts` | Add `suggestionEntrySchema` and `suggestions` to `NID_JSON_SCHEMA` |
| `src/utils/normalize.ts` | Normalise/default empty `suggestions` to `{}` |
| `src/prompts/shared/outputSchema.ts` | Document `suggestions` in the model-facing schema spec |
| `src/prompts/smartTier2.ts` | Update GAP-DETECTED FIELDS section with suggestion instructions and rules |
| `src/api/openapi.ts` | Document the new field, add example payload |
| `CLAUDE.md` | Mention suggestions in the NID Field Layout section |

## 6. Detailed prompt addition (Tier-2)

After the existing GAP-DETECTED FIELDS section, add:

```
── Producing suggestions for [GAP DETECTED] fields ───────────────────────────
For each [GAP DETECTED] field, in addition to the conservative `value`
(only legible characters), populate a suggestions entry as follows:

OUTPUT shape (only for the field, only when criteria below are met):
  suggestions.<fieldKey> = {
    estimatedLength: <integer>,        // chars in the obliterated word
    partialVisible:  "<short text>",   // e.g. "ত at right edge of dark zone"
    candidates:      ["...", "...", "..."]  // up to 3 full reconstructions
  }

ESTIMATING obliterated word length:
  - Measure the width of the bright/dark glare zone in the NEGATED variant
  - Compare to the average character width of the visible portion
  - Estimate how many character clusters fit in that width
  - Report a single integer (typically 3–8 for Bengali names)

ANCHORING candidates:
  - The visible boundary character is your anchor — every candidate's
    obliterated portion must END (or START) with that character
  - For mother/father names: the obliterated portion is the PREFIX
    (e.g. "ত আরা বেগম" → candidates fill in the prefix ending in ত)

CHOOSING candidates:
  - Each candidate must be a name from BENGALI NAME GENDER PATTERNS
    matching the holder's inferred gender
  - Each candidate's obliterated-portion length must equal estimatedLength ± 1
  - List highest-confidence candidates first, max 3 entries
  - Each candidate is the FULL reconstructed value (prefix + visible portion)

WHEN TO OMIT:
  - If you cannot identify any anchor character → omit this field's suggestions
  - If no vocabulary names match the anchor + length → omit
  - Do NOT emit suggestions with an empty candidates array

KEEP `value` CONSERVATIVE:
  - `value` stays as the legible portion only (e.g. "ত আরা বেগম")
  - Do not put a candidate in `value` — suggestions is where guesses go
```

## 7. Schema additions

### TypeScript / Zod (`models.ts`)

```ts
const SuggestionEntrySchema = z.object({
  estimatedLength: z.number().int().min(0),
  partialVisible:  z.string(),
  candidates:      z.array(z.string()).min(1).max(3),
});

export const NidResultSchema = z.object({
  ... existing ...,
  qualityIssues: z.array(z.string()).default([]),
  suggestions:   z.record(SuggestionEntrySchema).default({}),
});
```

### JSON Schema (`nidSchema.ts`)

```ts
const suggestionEntrySchema = {
  type: 'object',
  required: ['estimatedLength', 'partialVisible', 'candidates'],
  properties: {
    estimatedLength: { type: 'integer', minimum: 0 },
    partialVisible:  { type: 'string' },
    candidates:      { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
  },
};

// In NID_JSON_SCHEMA.properties:
suggestions: {
  type: 'object',
  additionalProperties: suggestionEntrySchema,
},
```

## 8. Example output

For the trigger image:

```json
{
  "cardType": "laminated",
  "motherNameBn": {
    "value": "ত আরা বেগম",
    "confidence": "low",
    "needsReview": true
  },
  ... other fields ...,
  "qualityIssues": ["gap_motherNameBn"],
  "suggestions": {
    "motherNameBn": {
      "estimatedLength": 5,
      "partialVisible": "ত at right edge of obliterated zone",
      "candidates": [
        "জিনাত আরা বেগম",
        "রিফাত আরা বেগম",
        "নুসরাত আরা বেগম"
      ]
    }
  }
}
```

## 9. Order of work

1. Add Zod schema (`models.ts`) — declarative, no breaking changes due to `default({})`
2. Add JSON schema for response_format (`nidSchema.ts`)
3. Update normalize.ts to handle missing/empty suggestions
4. Update outputSchema.ts (model-facing doc)
5. Update smartTier2.ts (GAP-DETECTED instructions)
6. Update openapi.ts
7. Update CLAUDE.md
8. Mark plan as Implemented
9. Validate by re-running the trigger image

## 10. Validation

Re-run smart mode on the trigger image:
- `motherNameBn.value` should remain conservative (e.g. "ত আরা বেগম")
- `suggestions.motherNameBn` should be populated with 2–3 candidates,
  estimatedLength ~5, partialVisible mentioning ত
- For clean images (no gap fields): `suggestions` should be `{}`

## 11. Non-goals

- Suggestions for non-NID fields (this is NID-specific)
- Multi-anchor reasoning (e.g. visible characters in the middle of an
  obliterated word) — only boundary anchors supported in v1
- Reordering candidates by external popularity data

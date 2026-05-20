# `--image` Flag and API Field for Unknown/Combined Side Uploads

**Status:** Implemented (2026-05-20)
**Date:** 2026-05-20
**Builds on:** `combined-sides-image-support.md`

---

## 1. Problem

After implementing combined-side auto-detection, the CLI and API still force
callers to use `--front` / `front` field for a single image — even when that
image contains BOTH sides or the caller doesn't know which side it is. This is
misleading: the flag name implies the image is only the front, but the smart
strategy may auto-detect it as combined.

## 2. Goal

Provide an explicit way for callers to upload a single NID image without
asserting it is the front side. The strategy auto-detection then determines
whether it is front-only, back-only, or combined.

## 3. Approach

Add an `--image <path>` CLI flag and an `image` multipart API field as
alternatives to `--front`. When used, the NidImage is labelled with
`side: 'unknown'` (an existing side type). Smart mode already accepts
`'unknown'` images in its combined-side detection block — so no strategy
changes needed.

The existing `--front` / `front` paths continue to work unchanged, preserving
backward compatibility for callers that know the side.

## 4. Detailed changes

### 4.1 `scripts/runOne.ts`

Accept `--image` as an alternative to `--front`:

```
Usage:
  npx tsx scripts/runOne.ts --image <path>                       # unknown / auto-detect
  npx tsx scripts/runOne.ts --front <path>                       # front-only (explicit)
  npx tsx scripts/runOne.ts --front <path> --back <path>         # both sides explicit
  npx tsx scripts/runOne.ts --image <path> --mode smart          # combined image
```

Validation:
- Must provide either `--front` OR `--image`, not both
- `--back` may accompany `--front` but not `--image`
- Error messages updated accordingly

When `--image` is used, the resulting `NidImage` has `side: 'unknown'`.

### 4.2 API endpoint `POST /extract`

Add an optional `image` multipart file field. Mutual-exclusion validation:

- Must provide either `front` OR `image`
- `back` may accompany `front` but not `image`
- 400 error with clear message if both `front` and `image` are present
- 400 error if neither `front` nor `image` is present

When `image` is provided, the `NidImage` has `side: 'unknown'`.

### 4.3 `src/api/openapi.ts`

Add the `image` field to the multipart schema:

```yaml
image:
  type: string
  format: binary
  description: 'Single NID image of unknown side. Use this when you do not know
    whether the image is the front, the back, or contains both. Smart mode will
    auto-detect. Mutually exclusive with `front` and `back`.'
```

Update the endpoint description to mention the choice.

Update error examples to include the mutual-exclusion errors.

### 4.4 `CLAUDE.md`

Update the API endpoint and CLI sections to document the new flag/field.

## 5. What does NOT change

- `scripts/batch.ts` continues to label files as `side: 'front'`. Batch input
  is expected to be a folder of known-front images. (Future enhancement: a
  `--side unknown` flag for batch could be added separately.)
- The strategy code (smart.ts) — unchanged, already handles `'unknown'`.
- Other extraction modes — they don't care about combined detection and treat
  `'unknown'` the same as `'front'` for their existing logic.

## 6. Validation

- `npx tsx scripts/runOne.ts --image <combined-nid> --mode smart` should
  produce the same result as if we had said `--front`, with `visionOutputs[0].side`
  becoming `'combined'` after auto-detection.
- API call with `image` field should produce the same.
- API call with both `front` AND `image` should return a 400 error.
- API call with neither should return a 400 error.

## 7. Order of work

1. Update `runOne.ts` (CLI flag + validation)
2. Update API `extract.ts` route (multipart field + validation)
3. Update OpenAPI spec
4. Update CLAUDE.md
5. Mark plan as Implemented

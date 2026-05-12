/**
 * Normalizes a raw parsed NID JSON object before Zod validation.
 *
 * Some models occasionally return non-standard confidence values (e.g. "medium",
 * "none", "uncertain"). This walks every field result and coerces any value that
 * is not in the valid set {"high","low","unreadable"} to "low" with needsReview:true,
 * preventing a Zod parse error from crashing the extraction.
 */

const VALID_CONFIDENCE = new Set(['high', 'low', 'unreadable']);

function normalizeField(field: unknown): unknown {
  if (field === null || typeof field !== 'object') return field;
  const f = field as Record<string, unknown>;
  if (!('confidence' in f)) return f;

  if (!VALID_CONFIDENCE.has(f['confidence'] as string)) {
    return { ...f, confidence: 'low', needsReview: true };
  }
  return f;
}

export function normalizeNidJson(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  const result: Record<string, unknown> = { ...obj };

  const fieldKeys = [
    'nidNumber', 'nameEn', 'nameBn', 'dateOfBirth',
    'fatherNameBn', 'motherNameBn', 'addressBn',
    'bloodGroup', 'issueDate', 'pin',
  ];

  for (const key of fieldKeys) {
    if (key in result) result[key] = normalizeField(result[key]);
  }

  return result;
}

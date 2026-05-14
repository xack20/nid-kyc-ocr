/**
 * Normalizes a raw parsed NID JSON object before Zod validation.
 *
 * Some models occasionally return non-standard confidence values (e.g. "medium",
 * "none", "uncertain"). This walks every field result and coerces any value that
 * is not in the valid set {"high","low","unreadable"} to "low" with needsReview:true,
 * preventing a Zod parse error from crashing the extraction.
 */

const VALID_CONFIDENCE = new Set(['high', 'low', 'unreadable']);
const VALID_CARD_TYPES  = new Set(['smart', 'laminated', 'unknown']);
const VALID_OVERALL     = new Set(['high', 'medium', 'low']);

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

  // Normalize cardType
  if (!VALID_CARD_TYPES.has(result['cardType'] as string)) {
    result['cardType'] = 'unknown';
  }

  // Normalize overallConfidence
  if (!VALID_OVERALL.has(result['overallConfidence'] as string)) {
    result['overallConfidence'] = 'low';
  }

  // Lift flat field values into nested {value, confidence, needsReview} shape.
  // Some models return e.g. nidNumber: "12345" instead of nidNumber: {value: "12345", ...}
  const fieldKeys = [
    'nidNumber', 'nameEn', 'nameBn', 'dateOfBirth',
    'fatherNameBn', 'motherNameBn', 'addressBn',
    'bloodGroup', 'issueDate', 'pin',
  ];

  for (const key of fieldKeys) {
    if (!(key in result)) continue;
    const raw = result[key];
    // If the model returned a flat string/null instead of a nested object, wrap it
    if (raw === null || raw === undefined || typeof raw === 'string') {
      result[key] = { value: raw ?? null, confidence: 'low', needsReview: true };
    } else {
      result[key] = normalizeField(raw);
    }
  }

  return result;
}

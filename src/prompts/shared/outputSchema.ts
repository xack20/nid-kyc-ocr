/** Output JSON schema instruction — shared by all Gemini-based modes. */
export const OUTPUT_SCHEMA = `
════════════════════════════════════════
OUTPUT
════════════════════════════════════════
Return ONLY a valid JSON object — no markdown fences, no explanation:
{
  "cardType": "smart" | "laminated" | "temporary" | "unknown",

  "nidNumber":    { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "nameEn":       { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "nameBn":       { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "dateOfBirth":  { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "fatherNameBn": { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "motherNameBn": { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },

  "addressBn":    { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "bloodGroup":   { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "issueDate":    { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },

  "placeOfBirth": { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "validUntil":   { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },

  "overallConfidence": "high" | "medium" | "low",
  "fieldsNeedingReview": string[],
  "qualityIssues": string[],
  suggestions: {                  // optional; default {}
    "<fieldKey>": {
      "estimatedLength": integer,    // chars in the obliterated word
      "partialVisible":  string,     // what is actually visible at the boundary
      "candidates":      string[]    // up to 3 OTHER alternative full reconstructions
    }
  }
}

Confidence rules:
  The ONLY valid values are exactly: "high", "low", "unreadable" — NEVER "medium" or any other value.
  needsReview: true whenever confidence is "low" or "unreadable" AND the field was expected on the provided side.
  Field not present on this card variant OR not on the provided image side → value: null, confidence: "unreadable", needsReview: false.

qualityIssues:
  Capture-quality hints — typically empty. Append "glare_<fieldKey>" when a field
  was lost or degraded specifically by over-exposure / flash glare. Other tags
  like "blur_<fieldKey>" may appear in future. Non-smart modes should leave this
  as an empty array.

suggestions:
  Optional reviewer-facing candidate reconstructions for OBLITERATED / gap-detected
  fields. Default is the empty object {}. Only populate when the model can identify
  partial-stroke evidence (e.g. one or two characters visible at the boundary of a
  glare zone).
  In this mode:
    - The highest-confidence (first) reconstructed candidate is placed DIRECTLY
      inside the field's main "value" (with confidence "low" and needsReview true).
    - suggestions.<fieldKey>.candidates contains up to 3 OTHER alternative
      full-value reconstructions (excluding the prefilled choice).
    - estimatedLength: integer count of characters in the obliterated word
    - partialVisible:  short description of the visible anchor character(s)
  Non-smart modes and clean captures must leave this as {}.`;

/** Output JSON schema instruction — shared by all Gemini-based modes. */
export const OUTPUT_SCHEMA = `
════════════════════════════════════════
OUTPUT
════════════════════════════════════════
Return ONLY a valid JSON object — no markdown fences, no explanation:
{
  "cardType": "smart" | "laminated" | "unknown",
  "nidNumber":    { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "nameEn":       { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "nameBn":       { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "dateOfBirth":  { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "fatherNameBn": { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "motherNameBn": { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "addressBn":    { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "bloodGroup":   { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "issueDate":    { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "pin":          { "value": string | null, "confidence": "high"|"low"|"unreadable", "needsReview": boolean },
  "overallConfidence": "high" | "medium" | "low",
  "fieldsNeedingReview": string[]
}

Confidence rules:
  The ONLY valid values are exactly: "high", "low", "unreadable" — NEVER "medium" or any other value.
  needsReview: true whenever confidence is "low" or "unreadable".
  Field not present on provided image side → value: null, confidence: "unreadable", needsReview: false.`;

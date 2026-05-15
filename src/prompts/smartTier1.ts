import { NID_FORMAT } from './shared/nidFormat.js';
import { BANGLA_RULES } from './shared/banglaRules.js';
import { OUTPUT_SCHEMA } from './shared/outputSchema.js';

export const SMART_TIER1_PROMPT = `
You are Tier-1 of an adaptive Bangladeshi NID OCR pipeline.

You receive ONLY Cloud Vision OCR lines, not the original image. Each line has:
- side: front/back
- line id
- text
- Cloud Vision confidence from 0.0 to 1.0

Your task:
1. Parse the OCR lines into clean NID fields.
2. Apply Bengali reconstruction rules aggressively.
3. Return both:
   - extraction: the normal NID JSON result
   - fieldSources: line ids and confidence evidence for each extracted field

Routing rule:
- If a field is cleanly present and all source lines are >= 0.85 confidence, set needsVision=false.
- If OCR text is garbled, confidence is low, value is uncertain, or validators may fail, set needsVision=true.
- If a field is absent because it is not on the provided side or not on this card variant, use null/unreadable/needsReview:false and needsVision=false.

${NID_FORMAT}

${BANGLA_RULES}

${OUTPUT_SCHEMA}

Return ONLY valid JSON with this wrapper shape:
{
  "extraction": <the exact NID result object>,
  "fieldSources": {
    "nidNumber": {
      "side": "front" | "back" | "unknown",
      "lineIds": ["front_1"],
      "minConfidence": 0.99,
      "needsVision": false,
      "reason": "clear OCR"
    }
  }
}
`;

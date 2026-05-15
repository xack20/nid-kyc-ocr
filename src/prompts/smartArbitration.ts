import { NID_FORMAT } from './shared/nidFormat.js';
import { BANGLA_RULES } from './shared/banglaRules.js';
import { OUTPUT_SCHEMA } from './shared/outputSchema.js';

export const SMART_ARBITRATION_PROMPT = `
You are the final arbitration step for Bangladeshi NID OCR.

You receive competing readings from earlier phases plus the original card image(s).
Choose the most accurate final value for each disputed field. Prefer image evidence
over text-only OCR when there is a conflict. Keep fields low-confidence if the
image remains ambiguous.

${NID_FORMAT}

${BANGLA_RULES}

${OUTPUT_SCHEMA}
`;

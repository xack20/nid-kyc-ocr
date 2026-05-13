import { type Interactions } from '@google/genai';
import { extractWithCloudVision }    from '../providers/vision.js';
import { geminiClient, getResponseText, accumulateUsage } from '../providers/gemini.js';
import { NidResultSchema }           from '../core/models.js';
import { StepTimer }                 from '../core/timer.js';
import { extractJson }               from '../utils/json.js';
import { normalizeNidJson }          from '../utils/normalize.js';
import { config }                    from '../config/index.js';
import type { NidImage, ExtractionResult, VisionOutput } from '../core/types.js';
import type { IExtractionStrategy }  from './IExtractionStrategy.js';

const SYSTEM_INSTRUCTION = `You are a structured data extractor for Bangladeshi National ID (NID) cards.

You will receive raw OCR text extracted by Google Cloud Vision from a NID card image.
The text may contain noise, garbled characters, extra spaces, or split words.

Your job is to parse this raw text and produce clean, labeled NID fields.

LAMINATED NID — FRONT fields:
  "নাম:" → nameBn       "Name:" → nameEn
  "পিতা:" → fatherNameBn   "মাতা:" → motherNameBn
  "Date of Birth" → dateOfBirth  (normalise to DD MMM YYYY)
  "ID NO:" → nidNumber  (10, 13, or 17 digits only)

LAMINATED NID — BACK fields:
  "ঠিকানা:" → addressBn   "রক্তের গ্রুপ" / "Blood Group" → bloodGroup
  "প্রদানের তারিখ" → issueDate

SMART NID — additional back: PIN

Rules:
1. Header lines ("গণপ্রজাতন্ত্রী…", "Government of…", "জাতীয় পরিচয়…") are NOT fields — ignore.
2. Collapse spaced-out characters: "গ ণ প্র" → "গণপ্র", "N a m e" → "Name".
3. confidence "high"   = field clearly present in the text.
   confidence "low"    = field partially readable or ambiguous.
   confidence "unreadable" = field not found or too garbled.
4. The ONLY valid confidence values are exactly: "high", "low", "unreadable".
5. needsReview: true when confidence is "low" or "unreadable".

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
}`;

/**
 * Vision → Gemini (text-only) strategy.
 *
 * Cloud Vision extracts raw OCR text from the image(s).
 * Only that text — no image — is sent to Gemini for structured labeling.
 *
 * Cost advantage: zero image tokens charged to Gemini.
 * Trade-off: Gemini cannot see the image to resolve ambiguities in the OCR text.
 */
export class VisionToGeminiStrategy implements IExtractionStrategy {
  readonly mode = 'vision_to_gemini' as const;

  async extract(images: NidImage[]): Promise<ExtractionResult> {
    const timer = new StepTimer();
    const visionOutputs: VisionOutput[] = [];

    // Step 1: Cloud Vision on all images in parallel
    const visionResults = await Promise.all(
      images.map(async (img) => {
        const stepName = `vision_${img.side}`;
        const stop = timer.start(stepName);
        const rawText = await extractWithCloudVision(img.buffer);
        stop();
        const ms = timer.summary().steps[stepName]?.ms ?? 0;
        return { img, rawText, ms };
      }),
    );

    for (const { img, rawText, ms } of visionResults) {
      visionOutputs.push({ side: img.side, rawText, timingMs: ms });
    }

    // Step 2: Build text-only prompt — no images sent to Gemini
    const ocrContext = visionResults
      .map(({ img, rawText }) =>
        `=== OCR TEXT (${img.side.toUpperCase()}) ===\n${rawText || '(no text detected)'}`,
      )
      .join('\n\n');

    const stopGemini = timer.start('gemini_initial');
    const interaction = await geminiClient().interactions.create({
      model:              config.gemini.model,
      system_instruction: SYSTEM_INSTRUCTION,
      input: [
        {
          type: 'text',
          text: `Parse the following raw Cloud Vision OCR text and extract all NID fields:\n\n${ocrContext}`,
        } satisfies Interactions.TextContent,
        // ← no image parts — text only
      ],
    });
    stopGemini();

    const extraction = NidResultSchema.parse(
      normalizeNidJson(extractJson(getResponseText(interaction))),
    );

    return {
      mode:            this.mode,
      extraction,
      visionOutputs,
      timing:          timer.summary(),
      geminiCallCount: 1,
      tokenUsage:      accumulateUsage([interaction]),
    };
  }
}

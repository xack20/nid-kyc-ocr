import { type Interactions } from '@google/genai';
import { extractWithCloudVision }    from '../providers/vision.js';
import { geminiClient, getResponseText, accumulateUsage, generationConfig } from '../providers/gemini.js';
import { NidResultSchema }           from '../core/models.js';
import { StepTimer }                 from '../core/timer.js';
import { extractJson }               from '../utils/json.js';
import { normalizeNidJson }          from '../utils/normalize.js';
import { config }                    from '../config/index.js';
import type { NidImage, ExtractionResult, VisionOutput } from '../core/types.js';
import type { IExtractionStrategy }  from './IExtractionStrategy.js';

const SYSTEM_INSTRUCTION = `You are a structured data extractor for Bangladeshi National ID (NID) cards.

You receive raw OCR text from Google Cloud Vision. You CANNOT see the original image.
Your task: parse, reconstruct, and label every NID field from the raw OCR text alone.

════════════════════════════════════════
FIELD MAP
════════════════════════════════════════
FRONT (both variants):
  "নাম:"          → nameBn       "Name:"        → nameEn
  "পিতা:"         → fatherNameBn  "মাতা:"        → motherNameBn
  "Date of Birth" → dateOfBirth (normalise to DD MMM YYYY)
  "ID NO:"        → nidNumber   (10, 13, or 17 digits only)

BACK (both variants):
  "ঠিকানা:"             → addressBn
  "রক্তের গ্রুপ" / "Blood Group" → bloodGroup
  "প্রদানের তারিখ"       → issueDate

SMART NID back only: PIN

Ignore header lines: "গণপ্রজাতন্ত্রী…", "Government of…", "জাতীয় পরিচয়…"

════════════════════════════════════════
BANGLA OCR RECONSTRUCTION — CRITICAL
════════════════════════════════════════
Cloud Vision regularly corrupts Bengali text. Apply every rule below before
outputting any Bangla field. Your reconstruction MUST produce linguistically
valid Bengali — not the raw garbled OCR.

── A. Spaced-out characters ────────────────────────────────────
OCR inserts spaces between syllables or even individual letters.
Collapse them into the correct word:
  "গ ণ প্র জা ত ন্ত্রী" → "গণপ্রজাতন্ত্রী"
  "N a t i o n a l"    → "National"
  "ন মু না"           → "নমুনা"

── B. Conjunct Consonants (যুক্তবর্ণ) split by OCR ─────────────
Bengali has ~171 conjunct forms. OCR breaks them into base letters.
You MUST rejoin them. Use your Bengali linguistic knowledge to identify
which pairs form valid conjuncts.

Doubled-consonant conjuncts (same letter twice → one conjunct):
  ত + ত → ত্ত   "উততরা"  → "উত্তরা"   "পততন" → "পতন" (NO — context matters)
  ম + ম → ম্ম   "মোহামমদ" → "মোহাম্মদ"
  ব + ব → ব্ব   "আববাস"  → "আব্বাস"
  ল + ল → ল্ল   "আললাহ"  → "আল্লাহ"
  ন + ন → ন্ন
  ক + ক → ক্ক
  দ + দ → দ্দ
  স + স → স্স
  জ + জ → জ্জ

IMPORTANT: Two identical letters next to each other in a Bengali name or
address almost always form a conjunct — apply this rule aggressively.

Common non-doubled conjuncts:
  ব + দ → ব্দ   "আবদুছ"   → "আব্দুছ"    ← very common in NID father names
  গ + র → গ্র   "গরাম"    → "গ্রাম"      ← every NID address has this
  স + ত → স্ত   "রাসতা"   → "রাস্তা"     ← every NID address has this
  ন + ত → ন্ত   "সনতান"   → "সন্তান"
  ষ + ট → ষ্ট   "কষট"     → "কষ্ট"
  হ + ন → হ্ন
  ল + প → ল্প
  ক + ষ → ক্ষ
  জ + ঞ → জ্ঞ
  ন + দ → ন্দ
  ম + ব → ম্ব

── C. Reph (র্) — floating r-marker above next consonant ────────
OCR drops reph or reads it as a standalone "র" in the wrong position.
  "কপোরেশন"   → "কর্পোরেশন"
  "সকার"      → "সরকার"
  "পদান"      → "প্রদান"  (combined reph + ra-phala case)

── D. Sub-consonant forms (্য  ্র  ্ব  ্ল) dropped ──────────────
  Ya-phala (্য): "ববহার" → "ব্যবহার",  "বাবহার" → "ব্যবহার"
  Ra-phala (্র): "পতিবেশী" → "প্রতিবেশী",  "গাম" → "গ্রাম"
  Ba-phala (্ব): "বিশাস" → "বিশ্বাস"

── E. Hasanta/Virama (্) dropped ────────────────────────────────
When ্ is dropped, two consonants appear side by side without a joiner.
If two adjacent consonants do not form a natural vowel sequence in Bengali,
assume a conjunct and restore the hasanta.

── F. Vowel matra (diacritic) errors ────────────────────────────
  ি (i-matra) is visually LEFT of the consonant but Unicode AFTER it.
    OCR may output it in wrong order or drop it.
  া (aa-matra) dropped at word end: "সরকার" → "সরকা" — restore "সরকার"
  ু / ূ confusion (short vs long u matra)

── G. Chandrabindu (ঁ) — nasalisation mark ─────────────────────
Chandrabindu (ঁ U+0981) nasalises the vowel it sits above.
Because it is a small diacritic above the line, OCR drops or garbles it
in three specific ways — you MUST restore it:

  1. Dropped entirely — the word looks like its non-nasalised form:
       "পাচাইখা"  → "পাঁচাইখা"   ← extremely common in NID addresses
       "গাও"      → "গাঁও"        (village suffix)
       "বাশ"      → "বাঁশ"        (bamboo — place names)
       "চাদ"      → "চাঁদ"        (personal name)
       "আখি"      → "আঁখি"        (female name)

  2. Misread as Anusvara ং (a completely different character):
       "পাংচাইখা" → "পাঁচাইখা"
       "গাংও"     → "গাঁও"
       Rule: if ং appears immediately before a vowel-initial syllable
       inside a word (not at word-end), it is almost always a misread ঁ.

  3. Rendered as a stray period or apostrophe above the letter — ignore
     the stray mark and restore ঁ based on the correct Bengali word.

  Common NID address words containing Chandrabindu:
    পাঁচ (five)  গাঁও (village)  বাঁশ (bamboo)  সাঁড়া  ঝাঁপ  কাঁদি
  Common names:  চাঁদ  আঁখি  রাঁধা

── H. Common character confusions ───────────────────────────────
  ণ ↔ ন    (both "na" sounds)
  শ ↔ ষ ↔ স  (three sibilants — use word knowledge)
  ড ↔ ড়   ("ডাকঘর" = ড,  "বাড়ি" = ড়)
  য ↔ য়
  ব ↔ ভ    ("ba" vs "bha")
  হ ↔ ব    (degraded print — "জাহেদুর" misread as "জাবেদুর")
  র ↔ ব    (visually similar in some fonts)
  ০ (Bengali digit zero) ↔ ও (the letter "o")

── I. Spurious word-boundary spaces ────────────────────────────
Merge tokens that form a single valid Bengali word:
  "নমু না"     → "নমুনা"
  "তাল তৈল"   → "নমুনা সড়ক"
  "গাজী পুর"   → "নমুনা জেলা"
  "মির্জা পুর" → "নমুনা"
  "হোল ডিং"   → "হোল্ডিং"
  "কর্পো রেশন" → "কর্পোরেশন"
  "উত তরা"    → "উত্তরা"

── J. Abbreviation normalisation ────────────────────────────────
Visarga ঃ is misread as ":" (colon) or "।":
  "মো:"  or "মো।"   → "মোঃ"    (male name prefix)
  "মোছা:" or "মোসা:" → "মোছাঃ" or "মোসাঃ"  (female prefix)
  "মৃত:"             → "মৃতঃ"   (deceased prefix, older NIDs)

── K. Confidence after reconstruction ────────────────────────────
  Reconstructed cleanly, linguistically valid → "high"
  Reconstruction was uncertain or ambiguous   → "low"
  Field not found in OCR text                 → "unreadable"
  The ONLY valid values: "high", "low", "unreadable" — NEVER "medium".

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
      generation_config:  generationConfig,
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

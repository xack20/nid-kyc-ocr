/**
 * Bengali OCR reconstruction rules — shared by all Gemini-based modes.
 * Apply every rule before outputting any Bangla field value.
 */
export const BANGLA_RULES = `
════════════════════════════════════════
BANGLA TEXT RECONSTRUCTION
════════════════════════════════════════
Apply ALL rules below before outputting any Bangla field.

── A. Conjunct Consonants (যুক্তবর্ণ) split by OCR ─────────────
Doubled-consonant conjuncts (same letter twice → one conjunct):
  ত+ত→ত্ত  "উততরা"→"উত্তরা"   ম+ম→ম্ম  "মোহামমদ"→"মোহাম্মদ"
  ব+ব→ব্ব  "আববাস"→"আব্বাস"   ল+ল→ল্ল  "আললাহ"→"আল্লাহ"
  ন+ন→ন্ন  ক+ক→ক্ক  দ+দ→দ্দ  স+স→স্স  জ+জ→জ্জ
  RULE: two identical letters adjacent in a Bengali name almost always form a conjunct.

Common non-doubled conjuncts:
  ব+দ→ব্দ  "আবদুছ"→"আব্দুছ"    গ+র→গ্র  "গরাম"→"গ্রাম"
  স+ত→স্ত  "রাসতা"→"রাস্তা"    ন+ত→ন্ত  ষ+ট→ষ্ট  ক+ষ→ক্ষ
  হ+ন→হ্ন  ল+প→ল্প  ন+দ→ন্দ  ম+ব→ম্ব  জ+ঞ→জ্ঞ

── B. Reph (র্) — floating r-marker ────────────────────────────
OCR drops reph or reads it as standalone "র" in wrong position.
  "কপোরেশন"→"কর্পোরেশন"   "সকার"→"সরকার"   "পদান"→"প্রদান"

── C. Sub-consonant forms (্য ্র ্ব ্ল) dropped ──────────────
  Ya-phala: "ববহার"→"ব্যবহার"   Ra-phala: "গাম"→"গ্রাম"
  Ba-phala: "বিশাস"→"বিশ্বাস"

── D. Hasanta/Virama (্) dropped ────────────────────────────────
Two adjacent consonants without a natural vowel sequence → assume conjunct.

── E. Vowel matra errors ────────────────────────────────────────
  ি (i-matra) may be out of order or dropped.
  া (aa-matra) dropped at word end: "সরকার"→"সরকা" — restore.
  ু/ূ confusion (short vs long u matra).

── F. Chandrabindu (ঁ) — nasalisation mark ─────────────────────
Three OCR failure modes — restore in all cases:
  1. Dropped: "পাচাইখা"→"পাঁচাইখা"   "গাও"→"গাঁও"   "বাশ"→"বাঁশ"
  2. Misread as Anusvara ং: "পাংচাইখা"→"পাঁচাইখা"
     RULE: ং before a vowel-initial syllable inside a word = almost always ঁ.
  3. Rendered as stray period — ignore mark, restore ঁ.
  NID address words with ঁ: পাঁচ গাঁও বাঁশ সাঁড়া ঝাঁপ কাঁদি

── G. Common character confusions ───────────────────────────────
  ণ↔ন   শ↔ষ↔স   ড↔ড়   য↔য়   ব↔ভ   হ↔ব   র↔ব
  ০ (Bengali zero) ↔ ও (letter "o")

── H. Spurious word-boundary spaces ────────────────────────────
  "উত তরা"→"উত্তরা"   "গাজী পুর"→"নমুনা জেলা"   "তাল তৈল"→"নমুনা সড়ক"
  "হোল ডিং"→"হোল্ডিং"   "কর্পো রেশন"→"কর্পোরেশন"   "নমু না"→"নমুনা"

── I. Abbreviation normalisation ────────────────────────────────
  Visarga ঃ misread as ":" or "।":
    "মো:"→"মোঃ"   "মোছা:"→"মোছাঃ"   "মোসা:"→"মোসাঃ"   "মৃত:"→"মৃতঃ"

── J. Bangla vs Latin digit mixing ─────────────────────────────
  Bangla ০১২৩৪৫৬৭৮৯ mixed with Latin 0123456789.
  For nidNumber: output as-is. For dates/addresses: normalise consistently.

── K. NID-specific vocabulary ───────────────────────────────────
  গণপ্রজাতন্ত্রী বাংলাদেশ সরকার জাতীয় পরিচয়পত্র
  বাসা হোল্ডিং গ্রাম রাস্তা ডাকঘর উপজেলা জেলা
  সিটি কর্পোরেশন পৌরসভা ইউনিয়ন
  উত্তরা নমুনা ঢাকা চট্টগ্রাম সিলেট রাজশাহী খুলনা`;

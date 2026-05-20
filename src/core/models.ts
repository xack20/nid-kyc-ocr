import { z } from 'zod';

const FieldResult = z.object({
  value:       z.string().nullable(),
  confidence:  z.enum(['high', 'low', 'unreadable']),
  needsReview: z.boolean(),
});

export const NidResultSchema = z.object({
  /**
   * BD NID card variants:
   *   laminated  — old paper-laminated card (pre-2016), 13 or 17-digit NID, Bengali-first layout
   *   smart      — plastic card with chip (2016+), 10-digit NID, bilingual compact layout, MRZ on back
   *   temporary  — সাময়িক জাতীয় পরিচয়পত্র, paper form with validity date, usually 17 digits
   *   unknown    — could not determine variant
   */
  cardType: z.enum(['smart', 'laminated', 'temporary', 'unknown']),

  // ── Front side — all variants ─────────────────────────────
  nidNumber:    FieldResult,   // ID NO / NID No / NID number
  nameEn:       FieldResult,   // Name (English)
  nameBn:       FieldResult,   // নাম (Bengali)
  dateOfBirth:  FieldResult,   // Date of Birth / জন্ম তারিখ
  fatherNameBn: FieldResult,   // পিতা / Father
  motherNameBn: FieldResult,   // মাতা / Mother

  // ── Back side — all variants ──────────────────────────────
  addressBn:    FieldResult,   // ঠিকানা (all variants)
  bloodGroup:   FieldResult,   // রক্তের গ্রুপ / Blood Group (all variants)
  issueDate:    FieldResult,   // প্রদানের তারিখ / Issue Date (all variants)

  // ── Smart NID back only ───────────────────────────────────
  placeOfBirth: FieldResult,   // Place of Birth (smart NID back — English)

  // ── Temporary NID only ────────────────────────────────────
  validUntil:   FieldResult,   // Validity/expiry date on temporary NIDs

  overallConfidence:   z.enum(['high', 'medium', 'low']),
  fieldsNeedingReview: z.array(z.string()),

  /**
   * Capture-quality hints emitted by smart mode. Each entry tags a field whose
   * recovery was hampered by image quality, e.g. "glare_motherNameBn",
   * "blur_addressBn". Empty for non-smart modes and clean captures. Callers
   * can use this to prompt the user to re-upload a better photo.
   */
  qualityIssues:       z.array(z.string()).default([]),
});

export type NidResult = z.infer<typeof NidResultSchema>;

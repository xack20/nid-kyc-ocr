import { z } from 'zod';

const FieldResult = z.object({
  value:      z.string().nullable(),
  confidence: z.enum(['high', 'low', 'unreadable']),
  needsReview: z.boolean(),
});

export const NidResultSchema = z.object({
  cardType:     z.enum(['smart', 'laminated', 'unknown']),

  // Front side — both variants
  nidNumber:    FieldResult,
  nameEn:       FieldResult,
  nameBn:       FieldResult,
  dateOfBirth:  FieldResult,
  fatherNameBn: FieldResult,  // পিতা
  motherNameBn: FieldResult,  // মাতা

  // Back side — both variants
  addressBn:    FieldResult,  // ঠিকানা
  bloodGroup:   FieldResult,  // রক্তের গ্রুপ
  issueDate:    FieldResult,  // প্রদানের তারিখ

  // Smart NID back only
  pin:          FieldResult,

  overallConfidence:   z.enum(['high', 'medium', 'low']),
  fieldsNeedingReview: z.array(z.string()),
});

export type NidResult = z.infer<typeof NidResultSchema>;

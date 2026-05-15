import { z } from 'zod';
import { NidResultSchema } from './models.js';
import type { NidImage } from './types.js';

export type FieldKey = keyof z.infer<typeof NidResultSchema>;

export const NID_FIELD_KEYS = [
  'nidNumber',
  'nameEn',
  'nameBn',
  'dateOfBirth',
  'fatherNameBn',
  'motherNameBn',
  'addressBn',
  'bloodGroup',
  'issueDate',
  'placeOfBirth',
  'validUntil',
] as const;

export type NidFieldKey = (typeof NID_FIELD_KEYS)[number];

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  vertices: Point[];
}

export interface LineRecord {
  id: string;
  side: NidImage['side'];
  text: string;
  confidence: number;
  boundingBox?: BoundingBox;
}

export interface FieldSource {
  side: NidImage['side'];
  lineIds: string[];
  minConfidence: number;
  needsVision: boolean;
  reason: string;
}

const fieldSourceSchema = z.object({
  side: z.enum(['front', 'back', 'unknown']),
  lineIds: z.array(z.string()),
  minConfidence: z.number().min(0).max(1),
  needsVision: z.boolean(),
  reason: z.string(),
});

export const Tier1SmartResultSchema = z.object({
  extraction: NidResultSchema,
  fieldSources: z.record(fieldSourceSchema).default({}),
});

export type Tier1SmartResult = z.infer<typeof Tier1SmartResultSchema>;

export interface SmartRoutingDecision {
  field: NidFieldKey;
  action: 'pass' | 'verify' | 'absent';
  reason: string;
  source?: FieldSource;
}

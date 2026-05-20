const fieldResultSchema = {
  type: 'object',
  required: ['value', 'confidence', 'needsReview'],
  properties: {
    value:       { type: ['string', 'null'] },
    confidence:  { type: 'string', enum: ['high', 'low', 'unreadable'] },
    needsReview: { type: 'boolean' },
  },
};

const suggestionEntrySchema = {
  type: 'object',
  required: ['estimatedLength', 'partialVisible', 'candidates'],
  properties: {
    estimatedLength: { type: 'integer', minimum: 0 },
    partialVisible:  { type: 'string' },
    candidates:      { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
  },
};

const fieldKeys = [
  'nidNumber', 'nameEn', 'nameBn', 'dateOfBirth',
  'fatherNameBn', 'motherNameBn', 'addressBn',
  'bloodGroup', 'issueDate', 'placeOfBirth', 'validUntil',
];

/** JSON Schema for the NID result — passed to response_format.schema to guide model output. */
export const NID_JSON_SCHEMA = {
  type: 'object',
  required: [
    'cardType', 'nidNumber', 'nameEn', 'nameBn', 'dateOfBirth',
    'fatherNameBn', 'motherNameBn', 'addressBn', 'bloodGroup',
    'issueDate', 'placeOfBirth', 'validUntil',
    'overallConfidence', 'fieldsNeedingReview',
  ],
  properties: {
    cardType:            { type: 'string', enum: ['smart', 'laminated', 'temporary', 'unknown'] },
    overallConfidence:   { type: 'string', enum: ['high', 'medium', 'low'] },
    fieldsNeedingReview: { type: 'array', items: { type: 'string' } },
    qualityIssues:       { type: 'array', items: { type: 'string' } },
    suggestions:         { type: 'object', additionalProperties: suggestionEntrySchema },
    ...Object.fromEntries(fieldKeys.map(k => [k, fieldResultSchema])),
  },
} as const;

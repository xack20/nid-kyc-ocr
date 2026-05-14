/** JSON Schema for the NID result — passed to response_format.schema to guide model output. */
export const NID_JSON_SCHEMA = {
  type: 'object',
  required: [
    'cardType', 'nidNumber', 'nameEn', 'nameBn', 'dateOfBirth',
    'fatherNameBn', 'motherNameBn', 'addressBn', 'bloodGroup',
    'issueDate', 'pin', 'overallConfidence', 'fieldsNeedingReview',
  ],
  properties: {
    cardType:            { type: 'string', enum: ['smart', 'laminated', 'unknown'] },
    overallConfidence:   { type: 'string', enum: ['high', 'medium', 'low'] },
    fieldsNeedingReview: { type: 'array', items: { type: 'string' } },
    ...(Object.fromEntries(
      ['nidNumber', 'nameEn', 'nameBn', 'dateOfBirth', 'fatherNameBn',
       'motherNameBn', 'addressBn', 'bloodGroup', 'issueDate', 'pin'].map(k => [
        k,
        {
          type: 'object',
          required: ['value', 'confidence', 'needsReview'],
          properties: {
            value:       { type: ['string', 'null'] },
            confidence:  { type: 'string', enum: ['high', 'low', 'unreadable'] },
            needsReview: { type: 'boolean' },
          },
        },
      ]),
    )),
  },
} as const;

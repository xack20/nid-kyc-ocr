import { EXTRACTION_MODES } from '../core/types.js';

const fieldResult = {
  type:       'object',
  properties: {
    value:       { type: 'string', nullable: true },
    confidence:  { type: 'string', enum: ['high', 'low', 'unreadable'] },
    needsReview: { type: 'boolean' },
  },
};

const nidResult = {
  type:       'object',
  properties: {
    cardType:            { type: 'string', enum: ['smart', 'laminated', 'unknown'] },
    nidNumber:           fieldResult,
    nameEn:              fieldResult,
    nameBn:              fieldResult,
    dateOfBirth:         fieldResult,
    fatherNameBn:        fieldResult,
    motherNameBn:        fieldResult,
    addressBn:           fieldResult,
    bloodGroup:          fieldResult,
    issueDate:           fieldResult,
    pin:                 fieldResult,
    overallConfidence:   { type: 'string', enum: ['high', 'medium', 'low'] },
    fieldsNeedingReview: { type: 'array', items: { type: 'string' } },
  },
};

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title:       'KYC OCR API',
    version:     '2.0.0',
    description: 'Extracts structured fields from Bangladeshi NID cards using Gemini and/or Google Cloud Vision.',
    contact:     { email: 'sharafat.hossain@konasl.com' },
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local' }],

  paths: {
    '/extract': {
      post: {
        summary:     'Extract NID fields from one or two card images',
        operationId: 'extractNid',
        tags:        ['Extraction'],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type:       'object',
                required:   ['front'],
                properties: {
                  front: { type: 'string', format: 'binary', description: 'Front-side NID image (required)' },
                  back:  { type: 'string', format: 'binary', description: 'Back-side NID image (optional)' },
                  mode:  {
                    type:        'string',
                    enum:        EXTRACTION_MODES,
                    default:     'combined',
                    description: [
                      '`gemini_only` — Gemini reads the image directly, no Cloud Vision.',
                      '`vision_only` — Cloud Vision OCR only, returns raw text.',
                      '`vision_fed_gemini` — Cloud Vision runs first; its text is passed to Gemini as context.',
                      '`gemini_with_vision_tool` — Cloud Vision registered as a Gemini function tool; Gemini decides when to call it.',
                      '`combined` — Cloud Vision always runs AND is also a callable tool. Maximum accuracy.',
                    ].join('\n\n'),
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Successful extraction',
            content: {
              'application/json': {
                schema: {
                  type:       'object',
                  properties: {
                    success:         { type: 'boolean', example: true },
                    mode:            { type: 'string', enum: EXTRACTION_MODES },
                    extraction:      { ...nidResult, description: 'Structured NID fields. Absent when mode is vision_only.' },
                    visionOutputs: {
                      type:  'array',
                      items: {
                        type:       'object',
                        properties: {
                          side:      { type: 'string', enum: ['front', 'back', 'unknown'] },
                          rawText:   { type: 'string' },
                          timingMs:  { type: 'number' },
                        },
                      },
                    },
                    timing: {
                      type:       'object',
                      properties: {
                        steps:          { type: 'object', additionalProperties: { type: 'object' } },
                        visionTotalMs:  { type: 'number' },
                        geminiTotalMs:  { type: 'number' },
                        totalMs:        { type: 'number' },
                        totalFormatted: { type: 'string' },
                      },
                    },
                    geminiCallCount: { type: 'number' },
                  },
                },
              },
            },
          },
          '400': { description: 'Missing front image or invalid mode' },
          '500': { description: 'Extraction error' },
        },
      },
    },

    '/health': {
      get: {
        summary:     'Health check',
        operationId: 'health',
        tags:        ['System'],
        responses: {
          '200': {
            description: 'Service is up',
            content: {
              'application/json': {
                schema: {
                  type:       'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    model:  { type: 'string' },
                    time:   { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

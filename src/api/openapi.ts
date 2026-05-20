import { EXTRACTION_MODES } from '../core/types.js';

const fieldResult = {
  type:       'object',
  required:   ['value', 'confidence', 'needsReview'],
  properties: {
    value:       { type: 'string', nullable: true, description: 'Extracted value, or null if unreadable/absent' },
    confidence:  { type: 'string', enum: ['high', 'low', 'unreadable'], description: 'high = both sources agree | low = sources differ | unreadable = not found' },
    needsReview: { type: 'boolean', description: 'true when confidence is low or unreadable' },
  },
};

const nidResult = {
  type:       'object',
  description: 'Structured NID fields. Absent when mode is vision_only.',
  properties: {
    cardType: {
      type: 'string',
      enum: ['smart', 'laminated', 'temporary', 'unknown'],
      description: [
        '`laminated` — old paper card sealed in plastic (pre-2016), 13 or 17-digit NID',
        '`smart` — plastic card with chip (2016+), 10-digit NID, MRZ on back',
        '`temporary` — সাময়িক জাতীয় পরিচয়পত্র paper form with validity date',
        '`unknown` — could not determine variant',
      ].join('\n'),
    },
    // Front side — all variants
    nidNumber:    { ...fieldResult, description: 'NID number — 10 (smart), 13, or 17 digits (laminated/temporary). Spaces stripped.' },
    nameEn:       { ...fieldResult, description: 'Holder name in English' },
    nameBn:       { ...fieldResult, description: 'Holder name in Bengali (নাম)' },
    dateOfBirth:  { ...fieldResult, description: 'Date of birth — DD MMM YYYY format' },
    fatherNameBn: { ...fieldResult, description: "Father's name in Bengali (পিতা)" },
    motherNameBn: { ...fieldResult, description: "Mother's name in Bengali (মাতা)" },
    // Back side — all variants
    addressBn:    { ...fieldResult, description: 'Full address in Bengali (ঠিকানা)' },
    bloodGroup:   { ...fieldResult, description: 'Blood group — e.g. A+, O-, AB+' },
    issueDate:    { ...fieldResult, description: 'Card issue date (প্রদানের তারিখ / Issue Date)' },
    // Smart NID back only
    placeOfBirth: { ...fieldResult, description: 'Place of Birth — Smart NID back only (English). Null for laminated/temporary.' },
    // Temporary NID only
    validUntil:   { ...fieldResult, description: 'Validity/expiry date — Temporary NID only (বৈধতার মেয়াদ). Null for smart/laminated.' },
    overallConfidence:   { type: 'string', enum: ['high', 'medium', 'low'] },
    fieldsNeedingReview: { type: 'array', items: { type: 'string' }, description: 'List of field keys where needsReview is true' },
    qualityIssues:       {
      type: 'array',
      items: { type: 'string' },
      description: 'Smart-mode capture-quality hints (e.g. "glare_motherNameBn", "blur_addressBn"). Empty for non-smart modes and clean captures. Callers may use this to prompt the user to re-upload a better photo.',
    },
  },
};

const timingObject = {
  type:       'object',
  description: 'Per-step timing breakdown',
  properties: {
    steps: {
      type: 'object',
      description: 'Named steps e.g. vision_front, vision_back, gemini_initial, gemini_continuation_1',
      additionalProperties: {
        type:       'object',
        properties: {
          ms:        { type: 'number', description: 'Duration in milliseconds' },
          formatted: { type: 'string', description: 'Human-readable e.g. "1.23s" or "456ms"' },
          callCount: { type: 'number', description: 'Present when the same step ran more than once' },
        },
      },
    },
    visionTotalMs:  { type: 'number', description: 'Sum of all vision_* steps' },
    geminiTotalMs:  { type: 'number', description: 'Sum of all gemini_* steps' },
    totalMs:        { type: 'number' },
    totalFormatted: { type: 'string' },
  },
};

const tokenUsageObject = {
  type:       'object',
  description: 'Gemini token usage across all API calls. All zeros for vision_only.',
  properties: {
    inputTokens:   { type: 'number' },
    outputTokens:  { type: 'number' },
    totalTokens:   { type: 'number' },
    thoughtTokens: { type: 'number', description: 'Thinking tokens — non-zero only on reasoning models with thinking_level set' },
  },
};

const modeDescriptions: Record<string, string> = {
  gemini_only:              'Gemini reads the image(s) directly. No Cloud Vision. Confidence is self-assessed from image clarity.',
  vision_only:              'Cloud Vision OCR only. Returns raw text per side. No Gemini call. extraction field is absent.',
  vision_to_gemini:         'Cloud Vision extracts raw text, then that text only (no image) is sent to Gemini for structured labeling. Zero Gemini image tokens.',
  vision_fed_gemini:        'Cloud Vision runs first; image + CV text are both sent to Gemini as context. Gemini cross-verifies its own image read against the CV text.',
  gemini_with_vision_tool:  'Gemini receives images and a Cloud Vision function tool. Gemini decides when to invoke it for uncertain fields. JSON output enforced via response_format.',
  combined:                 'Cloud Vision always runs first (guaranteed pre-pass) AND is registered as a re-call tool. Maximum accuracy. JSON output enforced via response_format.',
  smart:                    'Adaptive pipeline: rich Cloud Vision scan, Tier-1 text-only Gemini parse, deterministic validators, then Tier-2 Pro visual verification only for uncertain fields/crops.',
};

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title:       'KYC OCR API',
    version:     '3.0.0',
    description: [
      'Extracts structured fields from Bangladeshi NID cards (laminated, smart, and temporary variants).',
      'Uses Gemini Interactions API and/or Google Cloud Vision depending on the selected extraction mode.',
      '',
      '## Extraction Modes',
      Object.entries(modeDescriptions).map(([k, v]) => `- **\`${k}\`** — ${v}`).join('\n'),
      '',
      '## NID Field Layout',
      '**Front (all variants):** nidNumber, nameEn, nameBn, dateOfBirth, fatherNameBn, motherNameBn',
      '**Back (all variants):** addressBn, bloodGroup, issueDate',
      '**Smart NID back only:** placeOfBirth',
      '**Temporary NID only:** validUntil',
    ].join('\n'),
    contact: { email: 'sharafat.hossain@konasl.com' },
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local development' }],

  tags: [
    { name: 'Extraction', description: 'NID field extraction endpoints' },
    { name: 'System',     description: 'Health and status' },
  ],

  paths: {
    '/extract': {
      post: {
        summary:     'Extract NID fields from one or two card images',
        description: 'Accepts a front image (required) and optional back image. Returns structured NID fields with per-field confidence scores and timing breakdown.',
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
                  front: {
                    type:        'string',
                    format:      'binary',
                    description: 'Front-side NID image (required). Supported: JPEG, PNG, WEBP, HEIC, HEIF.',
                  },
                  back: {
                    type:        'string',
                    format:      'binary',
                    description: 'Back-side NID image (optional). Provides address, blood group, issue date.',
                  },
                  mode: {
                    type:        'string',
                    enum:        EXTRACTION_MODES,
                    default:     'combined',
                    description: Object.entries(modeDescriptions)
                      .map(([k, v]) => `\`${k}\` — ${v}`)
                      .join('\n\n'),
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
                    extraction:      nidResult,
                    visionOutputs: {
                      type:        'array',
                      description: 'Raw Cloud Vision OCR output per image side. Empty for gemini_only.',
                      items: {
                        type:       'object',
                        properties: {
                          side:      { type: 'string', enum: ['front', 'back', 'unknown'] },
                          rawText:   { type: 'string', description: 'Full raw OCR text from Cloud Vision' },
                          timingMs:  { type: 'number', description: 'Cloud Vision call duration in ms' },
                        },
                      },
                    },
                    timing:          timingObject,
                    geminiCallCount: { type: 'number', description: 'Number of Gemini Interactions API calls made (including tool-call continuations)' },
                    tokenUsage:      tokenUsageObject,
                  },
                },
                example: {
                  success: true,
                  mode: 'combined',
                  extraction: {
                    cardType: 'laminated',
                    nidNumber:    { value: '1234567890123', confidence: 'high', needsReview: false },
                    nameEn:       { value: 'MD. SAMPLE USER', confidence: 'high', needsReview: false },
                    nameBn:       { value: 'মোঃ নমুনা ব্যবহারকারী', confidence: 'high', needsReview: false },
                    dateOfBirth:  { value: '01 Jan 1990', confidence: 'high', needsReview: false },
                    fatherNameBn: { value: 'মোঃ নমুনা পিতা', confidence: 'high', needsReview: false },
                    motherNameBn: { value: 'মোসাঃ নমুনা মাতা', confidence: 'high', needsReview: false },
                    addressBn:    { value: 'গ্রাম/রাস্তা: নমুনা সড়ক, ডাকঘর: নমুনা - ১২৩৪, নমুনা জেলা', confidence: 'high', needsReview: false },
                    bloodGroup:   { value: null,        confidence: 'unreadable', needsReview: false },
                    issueDate:    { value: '09/09/2013', confidence: 'high', needsReview: false },
                    placeOfBirth: { value: null,         confidence: 'unreadable', needsReview: false },
                    validUntil:   { value: null,         confidence: 'unreadable', needsReview: false },
                    overallConfidence: 'high',
                    fieldsNeedingReview: [],
                  },
                  visionOutputs: [
                    { side: 'front', rawText: 'গণপ্রজাতন্ত্রী বাংলাদেশ সরকার\n...', timingMs: 1980 },
                    { side: 'back',  rawText: 'ঠিকানা: গ্রাম/রাস্তা: নমুনা সড়ক...', timingMs: 2140 },
                  ],
                  timing: {
                    steps: {
                      vision_front:   { ms: 1980, formatted: '1.98s' },
                      vision_back:    { ms: 2140, formatted: '2.14s' },
                      gemini_initial: { ms: 27970, formatted: '27.97s' },
                    },
                    visionTotalMs: 4120, geminiTotalMs: 27970, totalMs: 32090, totalFormatted: '32.09s',
                  },
                  geminiCallCount: 1,
                  tokenUsage: { inputTokens: 2492, outputTokens: 401, totalTokens: 4490, thoughtTokens: 1597 },
                },
              },
            },
          },
          '400': {
            description: 'Bad request',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error:   { type: 'string' },
                  },
                },
                examples: {
                  missingFront: { value: { success: false, error: 'Missing required field "front".' } },
                  invalidMode:  { value: { success: false, error: 'Invalid mode "foo". Allowed: gemini_only, vision_only, ...' } },
                },
              },
            },
          },
          '500': {
            description: 'Extraction failed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error:   { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/health': {
      get: {
        summary:     'Health check',
        description: 'Returns service status, active Gemini model, and current server time.',
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
                    model:  { type: 'string', example: 'gemini-3.1-pro-preview', description: 'Active Gemini model (from GEMINI_MODEL env var)' },
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

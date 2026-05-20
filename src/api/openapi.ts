import { EXTRACTION_MODES } from '../core/types.js';

const fieldResult = {
  type:       'object',
  required:   ['value', 'confidence', 'needsReview'],
  properties: {
    value:       { type: 'string', nullable: true, description: 'Extracted value (or null if unreadable/absent). For gap-detected fields in smart mode, this contains the highest-confidence reconstructed candidate prefilled directly.' },
    confidence:  { type: 'string', enum: ['high', 'low', 'unreadable'], description: 'high = both sources agree or clean single-read | low = sources differ or prefilled reconstruction candidate | unreadable = not found' },
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
    suggestions: {
      type:        'object',
      description: 'Reviewer-facing candidate reconstructions for obliterated fields. Keyed by field name (e.g. "motherNameBn"). Populated only by smart mode when Tier-2 can identify partial-stroke evidence at the boundary of a gap-detected zone. In this mode, the highest-confidence (first) reconstruction is prefilled directly into the field\'s main `value` (marked with `confidence: "low"` and `needsReview: true`), and the up to three other alternative candidate reconstructions (if any) are placed in this object\'s `candidates` list. Empty `{}` for non-smart modes and clean captures. UIs typically render `candidates` as clickable chips for human review.',
      additionalProperties: {
        type:       'object',
        required:   ['estimatedLength', 'partialVisible', 'candidates'],
        properties: {
          estimatedLength: { type: 'integer', minimum: 0, description: 'Estimated number of Bengali character clusters in the obliterated word.' },
          partialVisible:  { type: 'string',  description: 'Short description of what is actually visible at the boundary (e.g. "ত at right edge of dark zone").' },
          candidates:      { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3, description: 'Up to 3 other alternative full-value reconstructions (excluding the highest-confidence candidate which is directly prefilled into the field\'s main `value`), ordered by model confidence.' },
        },
      },
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
  smart:                    'Adaptive pipeline: rich Cloud Vision scan, Tier-1 text-only Gemini parse, deterministic validators, then Tier-2 Pro visual verification only for uncertain fields/crops. Auto-detects single images that contain BOTH card sides stacked vertically and processes them as if both `front` and `back` were uploaded.',
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
        description: [
          'Accepts a single NID image (via `image`) or an explicit front/back pair (via `front` + optional `back`).',
          '',
          'Use `image` when you do not know whether the photo shows the front, the back, or contains both sides stacked — smart mode will auto-detect.',
          'Use `front` + optional `back` when you know which side each file is.',
          '',
          '`front` and `image` are mutually exclusive. `back` is only valid with `front`.',
        ].join('\n'),
        operationId: 'extractNid',
        tags:        ['Extraction'],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type:       'object',
                description: 'Provide EITHER `front` (with optional `back`) OR `image`. Exactly one of `front` / `image` must be present.',
                properties: {
                  front: {
                    type:        'string',
                    format:      'binary',
                    description: 'Explicit front-side NID image. Use when you know the photo is only the front. Mutually exclusive with `image`. Supported: JPEG, PNG, WEBP, HEIC, HEIF.',
                  },
                  back: {
                    type:        'string',
                    format:      'binary',
                    description: 'Back-side NID image (optional). Only valid alongside `front`. Provides address, blood group, issue date.',
                  },
                  image: {
                    type:        'string',
                    format:      'binary',
                    description: 'Single NID image of unknown side — front, back, or both sides stacked vertically. Smart mode auto-detects. Mutually exclusive with `front`/`back`.',
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
                          side:      { type: 'string', enum: ['front', 'back', 'unknown', 'combined'], description: '`combined` indicates smart-mode detected a single image containing both card sides' },
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
                  mode: 'smart',
                  extraction: {
                    cardType: 'smart',
                    nidNumber:    { value: '1234567890',  confidence: 'high', needsReview: false },
                    nameEn:       { value: 'MD. SAMPLE USER', confidence: 'high', needsReview: false },
                    nameBn:       { value: 'মোঃ নমুনা ব্যবহারকারী', confidence: 'high', needsReview: false },
                    dateOfBirth:  { value: '01 Jan 1990', confidence: 'high', needsReview: false },
                    fatherNameBn: { value: 'মোঃ নমুনা পিতা', confidence: 'high', needsReview: false },
                    motherNameBn: { value: 'মোসাঃ জিনাত বেগম', confidence: 'low',  needsReview: true },
                    addressBn:    { value: 'গ্রাম/রাস্তা: নমুনা সড়ক, ডাকঘর: নমুনা - ১২৩৪, নমুনা জেলা', confidence: 'high', needsReview: false },
                    bloodGroup:   { value: 'O+',         confidence: 'high', needsReview: false },
                    issueDate:    { value: '09/09/2018', confidence: 'high', needsReview: false },
                    placeOfBirth: { value: 'Dhaka',       confidence: 'high', needsReview: false },
                    validUntil:   { value: null,         confidence: 'unreadable', needsReview: false },
                    overallConfidence: 'medium',
                    fieldsNeedingReview: ['motherNameBn'],
                    qualityIssues: ['gap_motherNameBn', 'glare_motherNameBn'],
                    suggestions: {
                      motherNameBn: {
                        estimatedLength: 5,
                        partialVisible: 'ত at right edge of dark zone',
                        candidates: ['মোসাঃ রাবেয়া বেগম', 'মোসাঃ সুফিয়া বেগম', 'মোসাঃ ফাতেমা বেগম']
                      }
                    }
                  },
                  visionOutputs: [
                    { side: 'combined', rawText: 'গণপ্রজাতন্ত্রী বাংলাদেশ সরকার\n...', timingMs: 1980 }
                  ],
                  timing: {
                    steps: {
                      vision_front:    { ms: 1980, formatted: '1.98s' },
                      gemini_initial:  { ms: 1200, formatted: '1.20s' },
                      gemini_tier2_motherNameBn: { ms: 3500, formatted: '3.50s' }
                    },
                    visionTotalMs: 1980, geminiTotalMs: 4700, totalMs: 6680, totalFormatted: '6.68s',
                  },
                  geminiCallCount: 2,
                  tokenUsage: { inputTokens: 4200, outputTokens: 850, totalTokens: 5050, thoughtTokens: 0 },
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
                  missingImage:  { value: { success: false, error: 'Missing image. Provide either "front" or "image" as multipart/form-data.' } },
                  bothFrontAndImage: { value: { success: false, error: '"front" and "image" are mutually exclusive. Use one or the other.' } },
                  backWithImage: { value: { success: false, error: '"back" can only accompany "front", not "image".' } },
                  invalidMode:   { value: { success: false, error: 'Invalid mode "foo". Allowed: gemini_only, vision_only, ...' } },
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

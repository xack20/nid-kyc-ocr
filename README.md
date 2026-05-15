# KYC OCR — Bangladeshi NID Card Extraction

TypeScript REST API and CLI toolkit for extracting structured fields from Bangladeshi National ID cards. The system combines Google Cloud Vision OCR with Gemini Interactions API workflows and supports front-only or front+back image processing for laminated, smart, and temporary NID variants.

The project is designed for high-accuracy KYC extraction, not generic OCR. It understands Bangladeshi NID layouts, Bengali + English mixed text, front/back field placement, card-type differences, and confidence-based manual review routing.

---

## What This Extracts

| Area | Fields |
|---|---|
| Front side | `nidNumber`, `nameEn`, `nameBn`, `dateOfBirth`, `fatherNameBn`, `motherNameBn` |
| Back side | `addressBn`, `bloodGroup`, `issueDate` |
| Smart NID back | `placeOfBirth` |
| Temporary NID | `validUntil` |

Supported card variants:

| Variant | Description | Typical NID length |
|---|---|---|
| `smart` | Plastic chip card, barcode/MRZ on back, compact bilingual layout | 10 digits |
| `laminated` | Old laminated card, red `ID NO`, Bengali address on back | 13 or 17 digits |
| `temporary` | Temporary paper NID document with validity date | Usually 17 digits |
| `unknown` | Variant could not be determined safely | 10 / 13 / 17 digits |

---

## Architecture

The service exposes several extraction modes. The two most important modes are:

| Mode | Purpose |
|---|---|
| `combined` | Full double-check mode: Cloud Vision runs first, Gemini receives the images and CV text, and Cloud Vision is also available as a Gemini tool. |
| `smart` | Adaptive mode: Cloud Vision rich OCR + cheap text parser first, then Gemini Pro only verifies uncertain fields using targeted image crops. |

High-level smart mode flow:

```text
Front/back NID images
        |
        v
Google Cloud Vision rich OCR
raw text + line confidence + bounding boxes
        |
        v
Tier-1 Gemini text parser
parses CV text into structured NID fields
        |
        v
Deterministic validators
NID length, dates, blood group, Bengali script, card-type rules
        |
        v
Field-level router
PASS / VERIFY / ABSENT
        |
        v
Tier-2 Gemini Pro visual verification
only for uncertain fields, using cropped image regions
        |
        v
Final JSON result + timing + token usage + review flags
```

Why this matters:

- Clean fields avoid expensive full-image Gemini Pro verification.
- Uncertain fields get focused visual attention.
- Cloud Vision confidence and bounding boxes are used instead of discarded.
- Validators catch obvious OCR/model mistakes before final output.
- Every output includes timing, token usage, source OCR, and confidence flags.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Extraction Modes](#extraction-modes)
- [Smart Mode Technical Details](#smart-mode-technical-details)
- [REST API](#rest-api)
- [CLI Scripts](#cli-scripts)
- [Output Format](#output-format)
- [NID Field Reference](#nid-field-reference)
- [Validation And Testing](#validation-and-testing)
- [Project Structure](#project-structure)
- [Security And Compliance](#security-and-compliance)

---

## Prerequisites

- Node.js 20+
- Google Cloud project with Cloud Vision API enabled
- Gemini API key from Google AI Studio
- Google Cloud service account JSON with Cloud Vision access

Recommended local files:

```text
.env
service-account.json
nid_images/
```

Do not commit `.env`, service account credentials, or real customer NID images.

---

## Installation

```bash
git clone <repo-url>
cd kyc-ocr
npm install
cp .env.example .env
```

Then edit `.env` with your credentials.

---

## Configuration

Basic `.env`:

```env
GEMINI_API_KEY=your_api_key_from_aistudio
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
PORT=3000

# Main high-accuracy model
GEMINI_MODEL=gemini-3.1-pro-preview

# Thinking level for Gemini calls: minimal | low | medium | high
GEMINI_THINKING_LEVEL=high
```

Smart mode settings:

```env
# Tier 1 parses Cloud Vision text only.
SMART_TIER1_MODEL=gemini-3.1-flash-lite

# Tier 2 verifies uncertain fields visually.
SMART_TIER2_MODEL=gemini-3.1-pro-preview

# Minimum CV/source confidence required to skip Tier 2.
SMART_CV_CONF_THRESHOLD=0.85

# Max uncertain fields sent to Tier 2 in one extraction.
SMART_MAX_TIER2_FIELDS=8
```

Model notes:

| Model | Role |
|---|---|
| `gemini-3.1-pro-preview` | Highest-capability visual reasoning model used for Pro verification |
| `gemini-2.5-pro` | Stable high-accuracy alternative |
| `gemini-3.1-flash-lite` | Fast text-only Tier-1 parser for smart mode |
| `gemini-3-flash-preview` | Faster general-purpose Gemini option |

---

## Extraction Modes

| Mode | Cloud Vision | Gemini | Use case |
|---|---|---|---|
| `vision_only` | Yes | No | Debug raw OCR quality and language hints |
| `gemini_only` | No | Full image read | Quick baseline without CV |
| `vision_to_gemini` | Yes | CV text only | Cheap structured output, no Gemini image tokens |
| `vision_fed_gemini` | Yes | Full image + CV context | Gemini reads image and compares CV text |
| `gemini_with_vision_tool` | On demand | Gemini tool loop | Gemini decides when to call Cloud Vision |
| `combined` | Always + tool | Full image + tool loop | Maximum full-card cross-verification |
| `smart` | Rich CV + crops | Tier-1 text + Tier-2 crops | Adaptive maximum accuracy and lower Pro usage |

Recommended usage:

| Scenario | Recommended mode |
|---|---|
| Production KYC with balanced cost/accuracy | `smart` |
| Highest full-card verification regardless of cost | `combined` |
| Raw OCR debugging | `vision_only` |
| Model-only comparison | `gemini_only` |
| Very low-cost structured extraction | `vision_to_gemini` |

---

## Smart Mode Technical Details

Smart mode is implemented in [src/strategies/smart.ts](src/strategies/smart.ts).

### Phase 1: Rich Cloud Vision OCR

Cloud Vision runs on all provided images, normally `front` and optionally `back`.

Configuration:

```ts
imageContext: {
  languageHints: ['bn', 'en'],
  textDetectionParams: {
    enableTextDetectionConfidenceScore: true,
    advancedOcrOptions: ['legacyLayout'],
  },
}
```

The rich OCR layer produces:

| Data | Purpose |
|---|---|
| Raw text | Full fallback text and audit trace |
| Line records | LLM-friendly text chunks |
| Confidence scores | Field-level routing signal |
| Bounding boxes | Crop uncertain fields for Gemini Pro |
| Side marker | Keeps front/back extraction separate |

Implemented in [src/providers/vision.ts](src/providers/vision.ts).

### Phase 2: Tier-1 Gemini Text Parser

Tier 1 sends Cloud Vision text lines to a fast text model. It does not send full images.

Default model:

```env
SMART_TIER1_MODEL=gemini-3.1-flash-lite
```

Tier 1 returns:

- Full NID extraction object.
- Source line IDs for each field.
- Minimum CV confidence for each field.
- Whether the field needs visual verification.

Prompt: [src/prompts/smartTier1.ts](src/prompts/smartTier1.ts)

### Phase 3: Deterministic Validators

Before trusting Tier 1, pure TypeScript validators inspect the output.

Examples:

| Validator | Rule |
|---|---|
| NID number | Smart NID should be 10 digits; laminated/temporary allow 10, 13, or 17 |
| Dates | DOB, issue date, and validUntil must look date-like and have reasonable ranges |
| Blood group | Must be one of `A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, `O-` |
| Bengali fields | `nameBn`, `fatherNameBn`, `motherNameBn`, `addressBn` should contain Bengali script |
| Variant fields | `placeOfBirth` is smart-only; `validUntil` is temporary-only |

Implemented in:

- [src/utils/fieldValidators.ts](src/utils/fieldValidators.ts)
- [src/utils/crossFieldCheck.ts](src/utils/crossFieldCheck.ts)

### Phase 4: Field-Level Routing

Each field is routed independently:

| Route | Meaning | Action |
|---|---|---|
| `PASS` | Field is clear enough | Use Tier-1 value |
| `VERIFY` | Low confidence, validator issue, or explicit uncertainty | Send field crop to Tier-2 Pro |
| `ABSENT` | Field is not expected for this card type or provided side | Return null/unreadable without review |

The threshold is controlled by:

```env
SMART_CV_CONF_THRESHOLD=0.85
```

### Phase 5: Targeted Crop Verification

For `VERIFY` fields:

1. Find the source OCR line bounding box.
2. Crop that region from the original image.
3. Upload original image and crop through Gemini Files API.
4. Ask Gemini Pro to confirm or correct only the uncertain fields.

Crop utility: [src/utils/imageCrop.ts](src/utils/imageCrop.ts)

Tier-2 prompt: [src/prompts/smartTier2.ts](src/prompts/smartTier2.ts)

### Phase 6: Final Assembly

The final result is normalized and validated with Zod. It includes:

- structured extraction
- raw Cloud Vision outputs
- per-step timing
- Gemini call count
- token usage
- fields needing review

---

## REST API

Start the server:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

Interactive Swagger docs:

```text
http://localhost:3000/docs
```

### Health Check

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "ok",
  "model": "gemini-3.1-pro-preview",
  "time": "2026-05-15T00:00:00.000Z"
}
```

### Extract NID Fields

Endpoint:

```http
POST /extract
```

Request type:

```text
multipart/form-data
```

Fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `front` | file | Yes | Front-side NID image |
| `back` | file | No | Back-side NID image |
| `mode` | string | No | Extraction mode. Default is configured in server code, normally `combined` or `smart` depending on caller choice |

Examples:

```bash
# Front only, default mode
curl -X POST http://localhost:3000/extract \
  -F "front=@nid_images/others/3_1 OCR.jpg"

# Front + back using smart mode
curl -X POST http://localhost:3000/extract \
  -F "front=@nid_images/special/2/front.jpeg" \
  -F "back=@nid_images/special/2/back.jpeg" \
  -F "mode=smart"

# Full combined verification
curl -X POST http://localhost:3000/extract \
  -F "front=@nid_images/special/2/front.jpeg" \
  -F "back=@nid_images/special/2/back.jpeg" \
  -F "mode=combined"
```

Success response shape:

```json
{
  "success": true,
  "mode": "smart",
  "extraction": {
    "cardType": "smart",
    "nidNumber": {
      "value": "1234567890",
      "confidence": "high",
      "needsReview": false
    },
    "nameEn": {
      "value": "MD. SAMPLE USER",
      "confidence": "high",
      "needsReview": false
    },
    "nameBn": {
      "value": "মোঃ নমুনা ব্যবহারকারী",
      "confidence": "high",
      "needsReview": false
    },
    "dateOfBirth": {
      "value": "01 Jan 1990",
      "confidence": "high",
      "needsReview": false
    },
    "fatherNameBn": {
      "value": "মোঃ নমুনা পিতা",
      "confidence": "high",
      "needsReview": false
    },
    "motherNameBn": {
      "value": "মোসাঃ নমুনা মাতা",
      "confidence": "high",
      "needsReview": false
    },
    "addressBn": {
      "value": "বাসা / হোল্ডিং : ১২৩, গ্রাম / রাস্তা : নমুনা সড়ক, ডাকঘর : নমুনা - ১২৩৪, নমুনা জেলা",
      "confidence": "high",
      "needsReview": false
    },
    "bloodGroup": {
      "value": "O+",
      "confidence": "high",
      "needsReview": false
    },
    "issueDate": {
      "value": "01 Jan 2020",
      "confidence": "high",
      "needsReview": false
    },
    "placeOfBirth": {
      "value": "SAMPLE DISTRICT",
      "confidence": "high",
      "needsReview": false
    },
    "validUntil": {
      "value": null,
      "confidence": "unreadable",
      "needsReview": false
    },
    "overallConfidence": "high",
    "fieldsNeedingReview": []
  },
  "visionOutputs": [
    {
      "side": "front",
      "rawText": "...",
      "timingMs": 1180
    },
    {
      "side": "back",
      "rawText": "...",
      "timingMs": 1220
    }
  ],
  "timing": {
    "steps": {
      "vision_front": {
        "ms": 1180,
        "formatted": "1.18s"
      },
      "vision_back": {
        "ms": 1220,
        "formatted": "1.22s"
      },
      "gemini_tier1_text_parse": {
        "ms": 6662,
        "formatted": "6.66s"
      }
    },
    "visionTotalMs": 2400,
    "geminiTotalMs": 6662,
    "totalMs": 7940,
    "totalFormatted": "7.94s"
  },
  "geminiCallCount": 1,
  "tokenUsage": {
    "inputTokens": 0,
    "outputTokens": 0,
    "totalTokens": 0,
    "thoughtTokens": 0
  }
}
```

Error responses:

| Status | Cause |
|---|---|
| `400` | Missing `front`, invalid mode, or invalid upload |
| `500` | Cloud Vision failure, Gemini failure, schema parse failure, or unexpected extraction error |

---

## CLI Scripts

All CLI scripts support `--mode`.

Use `NODE_OPTIONS=--disable-warning=DEP0040` if your Node version prints the `punycode` deprecation warning. The npm scripts already include it.

### Single Front/Back Pair

```bash
npm run extract -- \
  --front nid_images/special/2/front.jpeg \
  --back nid_images/special/2/back.jpeg \
  --mode smart
```

Equivalent direct command:

```bash
npx tsx scripts/runOne.ts \
  --front nid_images/special/2/front.jpeg \
  --back nid_images/special/2/back.jpeg \
  --mode smart
```

Output:

```text
outputs/<front_filename>_<mode>_<timestamp>.json
```

### Batch Front-Only Directory

```bash
npm run batch -- --dir ./nid_images/others --mode smart
```

Output:

```text
outputs/batch_<mode>_<timestamp>/
├── <image>.json
└── _summary.json
```

### Batch Front+Back Pairs

Expected directory format:

```text
nid_images/special/
├── 1/
│   ├── front.jpeg
│   └── back.jpeg
├── 2/
│   ├── front.jpg
│   └── back.jpg
```

Run:

```bash
npm run batch:special -- --dir ./nid_images/special --mode smart
```

Output:

```text
outputs/special_smart_<timestamp>/
├── pair_1.json
├── pair_2.json
├── ...
└── _summary.json
```

The special batch summary includes:

- pair ID
- card type
- extracted key fields
- overall confidence
- fields needing review
- timing
- Gemini call count
- token usage

### Benchmark Models

```bash
npm run benchmark -- --front nid_images/others/Customer_nid_front.png
```

This compares configured Gemini models on the same image and writes a benchmark JSON under `outputs/`.

---

## Output Format

Top-level output:

| Key | Description |
|---|---|
| `success` | API success flag |
| `mode` | Extraction mode used |
| `extraction` | Structured NID result, absent for `vision_only` |
| `visionOutputs` | Raw CV text and timing per side |
| `timing` | Per-step and total duration |
| `geminiCallCount` | Number of Gemini Interactions API calls |
| `tokenUsage` | Gemini token usage when available |

Per-field result:

```json
{
  "value": "string or null",
  "confidence": "high | low | unreadable",
  "needsReview": false
}
```

Confidence meanings:

| Confidence | Meaning |
|---|---|
| `high` | Sources and validators support the value |
| `low` | Conflict or uncertainty remains; review recommended |
| `unreadable` | Field could not be read or is absent for the provided side/card type |

`needsReview` is `false` for fields that are correctly absent. Example: `placeOfBirth` on a laminated NID should be null/unreadable but does not need review.

---

## NID Field Reference

### Common Front Fields

| Field | Labels / cues | Notes |
|---|---|---|
| `nidNumber` | `ID NO`, `NID No`, `NID নম্বর` | Digits only. Strip spaces. Smart cards usually have 10 digits. |
| `nameEn` | `Name` | English holder name. |
| `nameBn` | `নাম` | Bengali holder name. |
| `dateOfBirth` | `Date of Birth`, `জন্ম তারিখ` | Normalize where possible to `DD MMM YYYY`. |
| `fatherNameBn` | `পিতা`, `Father` | Bengali father name. |
| `motherNameBn` | `মাতা`, `Mother` | Bengali mother name. |

### Common Back Fields

| Field | Labels / cues | Notes |
|---|---|---|
| `addressBn` | `ঠিকানা` | Bengali address, often spans multiple lines. |
| `bloodGroup` | `Blood Group`, `রক্তের গ্রুপ` | Valid values: `A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, `O-`. |
| `issueDate` | `Issue Date`, `প্রদানের তারিখ` | Card issue date. |

### Variant-Specific Fields

| Field | Variant | Notes |
|---|---|---|
| `placeOfBirth` | Smart NID | Usually printed on the back in English. |
| `validUntil` | Temporary NID | Validity/expiry date on temporary paper NID. |

### Variant-Specific OCR Notes

| Variant | Important OCR behavior |
|---|---|
| Smart | Labels are small and may be above values; NID number can appear spaced like `123 456 7890`; MRZ lines must be ignored. |
| Laminated | Uses colon labels such as `নাম:`, `পিতা:`, `মাতা:`; NID often printed in red; back has Bengali legal text and barcode. |
| Temporary | Paper/form layout; may contain validity text and a different field arrangement. |

---

## Validation And Testing

Type check:

```bash
npx tsc --noEmit
```

Run one known front+back pair with smart mode:

```bash
npm run extract -- \
  --front nid_images/special/2/front.jpeg \
  --back nid_images/special/2/back.jpeg \
  --mode smart
```

Run all special front+back pairs:

```bash
npm run batch:special -- --dir nid_images/special --mode smart
```

Expected recent validation result:

| Dataset | Mode | Result |
|---|---|---|
| `nid_images/special` | `smart` | 10/10 succeeded |
| `nid_images/special` | `smart` | all `overallConfidence: high` |
| `nid_images/special` | `smart` | no fields needing review |

Smart mode timing behavior from the latest run:

| Case | Gemini calls | Typical total time |
|---|---:|---:|
| Clean smart card | 1 | ~7-8s |
| Laminated cards needing targeted verification | 2 | ~30-44s |

---

## Project Structure

```text
src/
├── api/
│   ├── middleware/          Upload + error middleware
│   ├── openapi.ts           Swagger/OpenAPI spec
│   └── routes.ts            REST routes
├── config/
│   └── index.ts             Env config, model registry, smart thresholds
├── core/
│   ├── models.ts            Zod NID result schema
│   ├── smartTypes.ts        Smart mode OCR/routing types
│   ├── timer.ts             Per-step timing helper
│   └── types.ts             Shared extraction types and modes
├── providers/
│   ├── gemini.ts            Gemini client, Files API, usage helpers
│   └── vision.ts            Cloud Vision OCR and rich line extraction
├── prompts/
│   ├── shared/              NID format, Bengali OCR rules, output schema
│   ├── smartTier1.ts        Tier-1 text parser prompt
│   ├── smartTier2.ts        Tier-2 crop verifier prompt
│   └── smartArbitration.ts  Arbitration prompt scaffold
├── strategies/
│   ├── combined.ts
│   ├── geminiOnly.ts
│   ├── geminiWithVisionTool.ts
│   ├── smart.ts
│   ├── visionFedGemini.ts
│   ├── visionOnly.ts
│   ├── visionToGemini.ts
│   └── index.ts
├── utils/
│   ├── crossFieldCheck.ts
│   ├── fieldValidators.ts
│   ├── imageCrop.ts
│   ├── json.ts
│   ├── mime.ts
│   ├── nidSchema.ts
│   ├── normalize.ts
│   └── timestamp.ts
├── server.ts
└── index.ts

scripts/
├── runOne.ts
├── batch.ts
├── batchSpecial.ts
└── benchmark.ts
```

---

## Security And Compliance

NID cards are sensitive personally identifiable information.

Operational rules:

- Never commit `.env`, service-account JSON, or real NID images.
- Keep raw OCR outputs and extracted JSON in controlled storage.
- Minimize retention of uploaded images and generated outputs.
- Use least-privilege Google Cloud service accounts.
- Prefer data residency close to Bangladesh when deploying cloud infrastructure.
- Review Bangladesh Bank KYC requirements and Bangladesh data protection requirements before production use.

Google/Gemini operational notes:

- Cloud Vision is language-hinted to Bengali + English.
- Gemini calls are deterministic where configured with `temperature: 0` and `seed`.
- Gemini Files API uploads are cleaned up where the strategy controls file lifecycle; files also expire automatically according to provider behavior.

---

## Known Practical Notes

- Low-resolution or blurry images may still require human review.
- Smart mode is adaptive: faster results usually mean no Tier-2 visual verification was needed.
- Laminated cards often need Tier-2 verification because old scans, red ink, and Bengali address lines are harder for OCR.
- `vision_only` is the best first debug step when extraction quality looks wrong.
- `combined` is still useful as a full-card cross-check baseline against `smart`.

# KYC OCR — Bangladeshi NID Card Extraction

Extracts structured fields from Bangladeshi National ID (NID) cards using **Gemini** and/or **Google Cloud Vision**. Supports laminated, smart, and temporary NID variants, front-only or front+back pairs, and seven configurable extraction strategies.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Extraction Modes](#extraction-modes)
- [REST API](#rest-api)
- [CLI Scripts](#cli-scripts)
- [NID Field Reference](#nid-field-reference)
- [Output Format](#output-format)
- [Project Structure](#project-structure)

---

## Prerequisites

- Node.js 20+
- Google Cloud project with **Cloud Vision API** enabled
- **Gemini API key** from [Google AI Studio](https://aistudio.google.com)
- Cloud Vision service account JSON

---

## Installation

```bash
git clone <repo-url>
cd kyc-ocr
npm install
cp .env.example .env   # then fill in your keys
```

---

## Configuration

Edit `.env`:

```env
GEMINI_API_KEY=your_api_key_from_aistudio
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
PORT=3000

# Model selection — see src/config/index.ts for all options
GEMINI_MODEL=gemini-3.1-pro-preview
```

### Available Models

| Model ID | Description |
|---|---|
| `gemini-3.1-pro-preview` | Latest, cutting-edge — **default** |
| `gemini-2.5-pro` | Stable, highest accuracy |
| `gemini-3.1-flash-lite` | Fast, lightweight Tier-1 parser |
| `gemini-3-flash-preview` | Fast, latest generation |

Change the active model by setting `GEMINI_MODEL` in `.env`. Unknown values fall back to the default with a console warning.

---

## Extraction Modes

| Mode | Cloud Vision | Gemini | Best for |
|---|---|---|---|
| `gemini_only` | No | Direct image read | Speed, no CV quota usage |
| `vision_only` | Yes | No | Debugging raw OCR quality |
| `vision_to_gemini` | Yes (text only) | Text prompt only | Cheapest structured output, zero Gemini image tokens |
| `vision_fed_gemini` | Pre-call | Context only | Structured output without function-call quota |
| `gemini_with_vision_tool` | On-demand | Tool loop | Gemini decides when to invoke OCR |
| `combined` | Always + tool | Full loop | **Maximum accuracy** (default) |
| `smart` | Rich CV + targeted crops | Tier-1 text parse + Tier-2 visual verify | Adaptive maximum accuracy with lower Pro usage |

**`combined` strategy flow:**
1. Cloud Vision runs on all images in parallel (guaranteed first pass)
2. CV raw text is passed as context to Gemini
3. Cloud Vision is also registered as a callable function tool for re-verification
4. Gemini extracts and cross-verifies all fields; disagreements are flagged `needsReview: true`

**`smart` strategy flow:**
1. Cloud Vision returns rich OCR lines with confidence and bounding boxes.
2. Gemini Flash Lite parses CV text only into labeled fields.
3. Validators route low-confidence or invalid fields to Pro vision.
4. Pro sees original images plus targeted crops only for uncertain fields.

---

## REST API

Start the server:

```bash
npm run dev       # development (hot-reload)
npm start         # production
```

Interactive API docs available at **`http://localhost:3000/docs`** (Swagger UI).

---

### `POST /extract`

Extract NID fields from one or two card images.

**Request** — `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `front` | file | ✅ | Front-side NID image |
| `back` | file | ❌ | Back-side NID image |
| `mode` | string | ❌ | Extraction mode (default: `combined`) |

**Example**

```bash
# Front only
curl -X POST http://localhost:3000/extract \
  -F "front=@nid_front.jpg"

# Front + back, specific mode
curl -X POST http://localhost:3000/extract \
  -F "front=@nid_front.jpg" \
  -F "back=@nid_back.jpg" \
  -F "mode=combined"
```

**Response `200`**

```json
{
  "success": true,
  "mode": "combined",
  "extraction": {
    "cardType": "laminated",
    "nidNumber":    { "value": "1234567890123", "confidence": "high", "needsReview": false },
    "nameEn":       { "value": "MD. SAMPLE USER",   "confidence": "high", "needsReview": false },
    "nameBn":       { "value": "মোঃ নমুনা ব্যবহারকারী",  "confidence": "high", "needsReview": false },
    "dateOfBirth":  { "value": "12 Sep 1994",        "confidence": "high", "needsReview": false },
    "fatherNameBn": { "value": "মোঃ নমুনা পিতা",  "confidence": "high", "needsReview": false },
    "motherNameBn": { "value": "মোসাঃ নমুনা মাতা","confidence": "high", "needsReview": false },
    "addressBn":    { "value": "গ্রাম/রাস্তা: ...", "confidence": "high", "needsReview": false },
    "bloodGroup":   { "value": null,                 "confidence": "unreadable", "needsReview": false },
    "issueDate":    { "value": "09/09/2013",          "confidence": "high", "needsReview": false },
    "placeOfBirth": { "value": null,                  "confidence": "unreadable", "needsReview": false },
    "validUntil":   { "value": null,                  "confidence": "unreadable", "needsReview": false },
    "overallConfidence": "high",
    "fieldsNeedingReview": []
  },
  "visionOutputs": [
    { "side": "front", "rawText": "...", "timingMs": 1980 },
    { "side": "back",  "rawText": "...", "timingMs": 2230 }
  ],
  "timing": {
    "steps": {
      "vision_front":   { "ms": 1980, "formatted": "1.98s" },
      "vision_back":    { "ms": 2230, "formatted": "2.23s" },
      "gemini_initial": { "ms": 27970, "formatted": "27.97s" }
    },
    "visionTotalMs": 4210,
    "geminiTotalMs": 27970,
    "totalMs": 30270,
    "totalFormatted": "30.27s"
  },
  "geminiCallCount": 1,
  "tokenUsage": {
    "inputTokens": 2404,
    "outputTokens": 319,
    "totalTokens": 3918,
    "thoughtTokens": 1195
  }
}
```

**Error responses**

| Status | Cause |
|---|---|
| `400` | Missing `front` field or invalid `mode` value |
| `500` | Extraction failed (model error, schema parse error) |

---

### `GET /health`

Returns service status and active model.

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "model": "gemini-3.1-pro-preview",
  "time": "2026-05-12T11:00:00.000Z"
}
```

---

### `GET /docs`

Swagger UI — interactive API documentation with live request testing.

---

## CLI Scripts

All scripts accept `--mode` to select the extraction strategy.

---

### `scripts/runOne.ts` — Single image extraction

```bash
npx tsx scripts/runOne.ts --front <path> [--back <path>] [--mode <mode>]
```

| Flag | Required | Default | Description |
|---|---|---|---|
| `--front` | ✅ | — | Path to front-side image |
| `--back` | ❌ | — | Path to back-side image |
| `--mode` | ❌ | `combined` | Extraction mode |

**Examples**

```bash
# Front only, default mode
npx tsx scripts/runOne.ts --front nid_images/others/Customer_nid_front.png

# Front + back pair
npx tsx scripts/runOne.ts \
  --front nid_images/special/1/front.jpeg \
  --back  nid_images/special/1/back.jpeg

# Specific mode
npx tsx scripts/runOne.ts --front nid.jpg --mode gemini_only

# Debug raw OCR
npx tsx scripts/runOne.ts --front nid.jpg --mode vision_only
```

Output is saved to `outputs/<filename>_<mode>_<timestamp>.json`.

---

### `scripts/batch.ts` — Batch directory processing

```bash
npx tsx scripts/batch.ts [--dir <path>] [--mode <mode>]
```

| Flag | Required | Default | Description |
|---|---|---|---|
| `--dir` | ❌ | `./nid_images/others` | Directory of front-side images |
| `--mode` | ❌ | `combined` | Extraction mode |

**Example**

```bash
npx tsx scripts/batch.ts --dir ./nid_images/others --mode vision_fed_gemini
```

Output: `outputs/batch_<timestamp>/` — one JSON per image + `_summary.json`.

---

### `scripts/batchSpecial.ts` — Front+back paired batch

For directories where each subdirectory contains a `front.*` and `back.*` image.

```bash
npx tsx scripts/batchSpecial.ts [--dir <path>] [--mode <mode>]
```

| Flag | Required | Default | Description |
|---|---|---|---|
| `--dir` | ❌ | `./nid_images/special` | Root directory of numbered pair subdirs |
| `--mode` | ❌ | `combined` | Extraction mode |

**Expected directory layout:**
```
special/
├── 1/
│   ├── front.jpeg
│   └── back.jpeg
├── 2/
│   ├── front.jpg
│   └── back.jpg
```

File names must contain `front` or `back` (case-insensitive). Any supported image extension works.

**Example**

```bash
npx tsx scripts/batchSpecial.ts --dir ./nid_images/special --mode combined
```

Output: `outputs/special_<timestamp>/` — one JSON per pair + `_summary.json`.

---

### `scripts/benchmark.ts` — Model comparison

Runs `gemini_only` mode across **all configured models** on a single image and prints a timing + token usage + extraction diff table.

```bash
npx tsx scripts/benchmark.ts --front <path>
```

| Flag | Required | Description |
|---|---|---|
| `--front` | ✅ | Image to benchmark against |

**Example**

```bash
npx tsx scripts/benchmark.ts --front nid_images/others/Customer_nid_front.png
```

Output: console table + `outputs/benchmark_gemini_only_<timestamp>.json`.

---

## NID Field Reference

### Front side (both variants)

| Field | Bangla label | Description |
|---|---|---|
| `nidNumber` | ID NO | 10, 13, or 17-digit NID number |
| `nameEn` | Name | Holder's name in English |
| `nameBn` | নাম | Holder's name in Bengali |
| `dateOfBirth` | Date of Birth | Format: `DD MMM YYYY` |
| `fatherNameBn` | পিতা | Father's name in Bengali |
| `motherNameBn` | মাতা | Mother's name in Bengali |

### Back side (both variants)

| Field | Bangla label | Description |
|---|---|---|
| `addressBn` | ঠিকানা | Full address in Bengali |
| `bloodGroup` | রক্তের গ্রুপ | e.g. `A+`, `O-` |
| `issueDate` | প্রদানের তারিখ | Card issue date |

### Smart NID back only

| Field | Description |
|---|---|
| `placeOfBirth` | Place of birth, printed on smart NID back side |

### Temporary NID only

| Field | Description |
|---|---|
| `validUntil` | Validity/expiry date for temporary NID documents |

### Per-field result shape

Every field returns:

```json
{
  "value": "string or null",
  "confidence": "high | low | unreadable",
  "needsReview": false
}
```

| Confidence | Meaning |
|---|---|
| `high` | Gemini and Cloud Vision agree |
| `low` | Gemini and Cloud Vision disagree — human review recommended |
| `unreadable` | Both sources failed to read the field |

`needsReview: true` is set automatically when `confidence` is `low` or `unreadable` (except for fields not present on the provided side).

---

## Output Format

Every JSON output file follows this structure:

```json
{
  "mode": "combined",
  "extraction": { ... },
  "visionOutputs": [ { "side": "front", "rawText": "...", "timingMs": 1980 } ],
  "timing": {
    "steps": {
      "vision_front":   { "ms": 1980, "formatted": "1.98s" },
      "gemini_initial": { "ms": 27970, "formatted": "27.97s" }
    },
    "visionTotalMs": 1980,
    "geminiTotalMs": 27970,
    "totalMs": 30270,
    "totalFormatted": "30.27s"
  },
  "geminiCallCount": 1,
  "tokenUsage": {
    "inputTokens": 2404,
    "outputTokens": 319,
    "totalTokens": 3918,
    "thoughtTokens": 1195
  }
}
```

Batch runs also produce a `_summary.json` with a flat array of all results for easy comparison.

---

## Project Structure

```
src/
├── config/           Environment config + model registry
├── core/             Shared types, Zod schema, StepTimer
├── providers/        Lazy singletons — Gemini client, Cloud Vision client
├── prompts/          Shared + mode-specific prompts
├── strategies/       Extraction strategies + factory, including smart mode
├── utils/            MIME, timestamp, JSON, validation, crop helpers
├── api/              Express routes, middleware, OpenAPI spec
├── server.ts         App factory
└── index.ts          Entry point

scripts/
├── runOne.ts         Single image / front+back pair
├── batch.ts          Directory batch
├── batchSpecial.ts   Front+back paired batch
└── benchmark.ts      Multi-model comparison
```

---

## Compliance Notes

- Cloud Vision language hints are fixed to `bn` (Bengali) + `en` (English)
- NID images contain PII — never commit them to version control (enforced by `.gitignore`)
- Credentials (`service-account.json`, `.env`) are git-ignored
- For production: use GCP `asia-south1` region and enforce Bangladesh Data Protection Act data residency requirements

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

KYC OCR service that extracts structured fields from Bangladeshi NID cards (laminated, smart, and temporary variants), targeting maximum accuracy using Gemini and/or Google Cloud Vision.

## Commands

```bash
npm run dev              # Start API server (hot-reload)
npm run build            # Compile TypeScript to dist/
npm run extract          # Alias for scripts/runOne.ts
npm run batch            # Alias for scripts/batch.ts
npm run batch:special    # Alias for scripts/batchSpecial.ts
npm run batch:recursive  # Alias for scripts/batchRecursive.ts

# CLI scripts (direct)
npx tsx scripts/runOne.ts --image <path> [--mode <mode>]            # auto-detect side
npx tsx scripts/runOne.ts --front <path> [--back <path>] [--mode <mode>]   # explicit side
npx tsx scripts/batch.ts [--dir <path>] [--mode <mode>]
npx tsx scripts/batchSpecial.ts [--dir <path>] [--mode <mode>]
npx tsx scripts/batchRecursive.ts [--dir <path>] [--mode <mode>]
```

## Architecture

```
src/
├── config/index.ts           # All env-based config (model, port, keys)
├── core/
│   ├── types.ts              # ExtractionMode, NidImage, ExtractionResult, VisionOutput
│   ├── models.ts             # Zod NidResultSchema + NidResult type
│   ├── smartTypes.ts         # Smart mode line records, routing, Tier-1 result types
│   └── timer.ts              # StepTimer — per-step timing with summary()
├── providers/
│   ├── gemini.ts             # GoogleGenAI singleton + response helpers
│   └── vision.ts             # Cloud Vision singleton + extractWithCloudVision()
├── prompts/
│   ├── shared/               # NID format, Bengali OCR rules, output schema
│   ├── geminiOnly.ts         # Image-only prompt
│   ├── visionToGemini.ts     # CV text-only prompt
│   ├── smartTier1.ts         # Smart mode CV text parser prompt
│   ├── smartTier2.ts         # Smart mode targeted visual verifier prompt
│   └── smartArbitration.ts   # Smart mode arbitration prompt (final conflict resolution)
├── strategies/               # Strategy pattern — one class per extraction mode
│   ├── IExtractionStrategy.ts
│   ├── geminiOnly.ts         # Gemini reads images directly, no Cloud Vision
│   ├── visionOnly.ts         # Cloud Vision raw OCR only, no Gemini
│   ├── visionFedGemini.ts    # CV runs first, its text fed to Gemini as context
│   ├── geminiWithVisionTool.ts # CV registered as Gemini function tool
│   ├── combined.ts           # CV always runs + registered as tool (max accuracy)
│   ├── smart.ts              # Rich CV + Tier-1 text parse + targeted Tier-2 verification
│   └── index.ts              # createStrategy(mode) factory
├── utils/
│   ├── mime.ts               # MIME type helpers + toImageMimeType()
│   ├── timestamp.ts          # ts() — filesystem-safe timestamp string
│   ├── json.ts               # extractJson() — pulls first JSON object from text
│   ├── imageCrop.ts          # sharp-based crop helper for smart mode
│   ├── imageEnhance.ts       # CLAHE-based enhancement for glare recovery
│   ├── glareDetection.ts     # luminance-grid scan → glare bounding boxes + coverage
│   ├── gapDetection.ts       # CV block-split analysis → label-value gap reports (flash/occlusion)
│   ├── sideClassification.ts # detect & reclassify single-image-with-both-sides combined uploads
│   ├── fieldValidators.ts    # deterministic validation/routing checks
│   └── crossFieldCheck.ts    # cross-field consistency checks (cardType↔nidNumber, placeOfBirth, validUntil)
├── api/
│   ├── middleware/upload.ts  # Multer config
│   ├── middleware/errorHandler.ts
│   ├── routes/extract.ts     # POST /extract
│   ├── routes/health.ts      # GET /health
│   ├── routes/docs.ts        # GET /docs — Swagger UI
│   └── openapi.ts            # OpenAPI 3.0 spec object
├── server.ts                 # createApp() — Express factory
└── index.ts                  # Entry point

scripts/                      # CLI runners (tsx, not compiled)
├── runOne.ts                 # Single image or front+back pair
├── batch.ts                  # Directory of front-only images
├── batchSpecial.ts           # Numbered subdirs with front+back pairs
└── batchRecursive.ts         # Recursively walk dirs (auto-detect sides)
```

## Extraction Modes

| Mode | Cloud Vision | Gemini | Use when |
|---|---|---|---|
| `gemini_only` | No | Direct | Fast, no CV quota |
| `vision_only` | Yes | No | Debug OCR quality |
| `vision_to_gemini` | Yes (text only) | Text prompt only | Zero Gemini image tokens |
| `vision_fed_gemini` | Yes (pre-call) | Image + text context | No function-call quota |
| `gemini_with_vision_tool` | On-demand | Tool loop | Gemini decides when to OCR |
| `combined` | Always + tool | Full loop | Maximum accuracy (default) |
| `smart` | Rich CV + targeted crops | Tier-1 text parser + Tier-2 visual verifier | Adaptive max accuracy with less Pro usage; auto-detects single image containing both sides |

## NID Field Layout

**Front (all variants):** `nidNumber`, `nameEn`, `nameBn`, `dateOfBirth`, `fatherNameBn` (পিতা), `motherNameBn` (মাতা)

**Back (all variants):** `addressBn` (ঠিকানা), `bloodGroup`, `issueDate` (প্রদানের তারিখ)

**Smart NID back only:** `placeOfBirth`

**Temporary NID only:** `validUntil`

**Smart mode capture-quality hints:** `qualityIssues: string[]` — tags like `"glare_motherNameBn"` flag fields where over-exposure (flash glare) hurt recovery. Empty for clean captures and non-smart modes. Callers can use this to prompt the user to re-upload.

**Smart mode reviewer suggestions:** `suggestions: Record<fieldKey, { estimatedLength, partialVisible, candidates[] }>` — for obliterated/gap-detected fields in smart mode, the highest-confidence (1st) reconstruction is prefilled directly into the field's main `value` (marked with `confidence: "low"` and `needsReview: true`), and up to three *other* alternative full-value candidate reconstructions are populated inside `candidates[]` for the reviewer to choose from. Empty `{}` for clean captures and non-smart modes. UIs typically render `candidates` as clickable chips.

## API Endpoints

- `POST /extract` — multipart: provide EITHER `image` (single image, side auto-detected) OR `front` (with optional `back`); plus `mode` (optional, default: `combined`). `front` and `image` are mutually exclusive; `back` is only valid with `front`.
- `GET /health` — service status + active model
- `GET /docs` — Swagger UI

## Environment

```
GEMINI_API_KEY=...
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
GEMINI_MODEL=gemini-3.1-pro-preview   # optional override
GEMINI_THINKING_LEVEL=high            # minimal|low|medium|high
PORT=3000

# Smart adaptive mode (optional overrides)
SMART_TIER1_MODEL=gemini-3.1-flash-lite   # fast text parser
SMART_TIER2_MODEL=gemini-3.1-pro-preview  # visual verifier (defaults to GEMINI_MODEL)
SMART_TIER2_THINKING_LEVEL=medium         # Tier 2 thinking level: minimal|low|medium|high
SMART_CV_CONF_THRESHOLD=0.85              # CV word confidence required to auto-pass a field
SMART_MAX_TIER2_FIELDS=8                  # max fields sent for visual verification per run
```

## Compliance

- Bangladesh Digital Security Act + Data Protection Act
- Bangladesh Bank KYC guidelines
- Cloud Vision language hints fixed to `bn` + `en`
- PII: prefer `asia-south1` region for GCP resources

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

KYC OCR service that extracts structured fields from Bangladeshi NID cards (both laminated and smart variants), targeting maximum accuracy using Gemini and/or Google Cloud Vision.

## Commands

```bash
npm run dev              # Start API server (hot-reload)
npm run build            # Compile TypeScript to dist/
npm run extract          # Alias for scripts/runOne.ts
npm run batch            # Alias for scripts/batch.ts
npm run batch:special    # Alias for scripts/batchSpecial.ts

# CLI scripts (direct)
npx tsx scripts/runOne.ts --front <path> [--back <path>] [--mode <mode>]
npx tsx scripts/batch.ts [--dir <path>] [--mode <mode>]
npx tsx scripts/batchSpecial.ts [--dir <path>] [--mode <mode>]
```

## Architecture

```
src/
├── config/index.ts           # All env-based config (model, port, keys)
├── core/
│   ├── types.ts              # ExtractionMode, NidImage, ExtractionResult, VisionOutput
│   ├── models.ts             # Zod NidResultSchema + NidResult type
│   └── timer.ts              # StepTimer — per-step timing with summary()
├── providers/
│   ├── gemini.ts             # GoogleGenAI singleton + response helpers
│   └── vision.ts             # Cloud Vision singleton + extractWithCloudVision()
├── prompts/
│   └── system.ts             # NID card format + parsing rules system instruction
├── strategies/               # Strategy pattern — one class per extraction mode
│   ├── IExtractionStrategy.ts
│   ├── geminiOnly.ts         # Gemini reads images directly, no Cloud Vision
│   ├── visionOnly.ts         # Cloud Vision raw OCR only, no Gemini
│   ├── visionFedGemini.ts    # CV runs first, its text fed to Gemini as context
│   ├── geminiWithVisionTool.ts # CV registered as Gemini function tool
│   ├── combined.ts           # CV always runs + registered as tool (max accuracy)
│   └── index.ts              # createStrategy(mode) factory
├── utils/
│   ├── mime.ts               # MIME type helpers + toImageMimeType()
│   ├── timestamp.ts          # ts() — filesystem-safe timestamp string
│   └── json.ts               # extractJson() — pulls first JSON object from text
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
└── batchSpecial.ts           # Numbered subdirs with front+back pairs
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

## NID Field Layout

**Front (both variants):** `nidNumber`, `nameEn`, `nameBn`, `dateOfBirth`, `fatherNameBn` (পিতা), `motherNameBn` (মাতা)

**Back (both variants):** `addressBn` (ঠিকানা), `bloodGroup`, `issueDate` (প্রদানের তারিখ)

**Smart NID back only:** `pin`

## API Endpoints

- `POST /extract` — multipart: `front` (required), `back` (optional), `mode` (optional, default: `combined`)
- `GET /health` — service status + active model
- `GET /docs` — Swagger UI

## Environment

```
GEMINI_API_KEY=...
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
GEMINI_MODEL=gemini-3.1-pro-preview   # optional override
PORT=3000
```

## Compliance

- Bangladesh Digital Security Act + Data Protection Act
- Bangladesh Bank KYC guidelines
- Cloud Vision language hints fixed to `bn` + `en`
- PII: prefer `asia-south1` region for GCP resources

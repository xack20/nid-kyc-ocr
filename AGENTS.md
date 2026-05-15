# Repository Guidelines

## Project Structure & Module Organization

- `src/index.ts` starts the service; `src/server.ts` builds the Express app.
- `src/api/` contains routes, middleware, and the OpenAPI spec.
- `src/strategies/` implements modes such as `combined`, `gemini_only`, and `vision_only`.
- `src/providers/` wraps Gemini and Cloud Vision clients.
- `src/prompts/`, `src/core/`, and `src/utils/` hold prompt text, shared types/models, timers, normalization, JSON, MIME, and timestamp helpers.
- `scripts/` contains CLI runners for single extraction, batch runs, and benchmarks.
- `docs/` stores benchmark notes. `nid_images/`, `outputs/`, and credentials are local runtime artifacts, not source.

## Build, Test, and Development Commands

- `npm install` installs dependencies from `package-lock.json`.
- `npm run dev` starts the API with `tsx watch` on `src/index.ts`.
- `npm run build` runs `tsc` and emits JavaScript into `dist/`.
- `npm start` runs the compiled service from `dist/index.js`.
- `npm run extract -- --front <path> [--back <path>] [--mode combined]` runs a single extraction.
- `npm run batch -- --dir <path> [--mode combined]` processes a directory of images.
- `npm run benchmark` runs `scripts/benchmark.ts`.

## Coding Style & Naming Conventions

Use strict TypeScript with ES modules and `NodeNext` resolution. Keep imports explicit and follow existing runtime-compatible ESM patterns. Group code by responsibility: providers for external services, strategies for extraction flows, utils for pure helpers. Use two-space indentation in JSON and match surrounding TypeScript style. Use `camelCase` for variables/functions, `PascalCase` for classes/types, and strategy names matching extraction modes.

## Testing Guidelines

There is currently no dedicated test runner or `test` script. Run `npm run build` as the minimum validation. For behavior changes, also run a targeted CLI check:

```bash
npm run extract -- --front nid_images/<sample>.jpg --mode combined
```

If adding tests, place them near the module or under `tests/`, name them after the unit or route, and add an `npm test` script.

## Commit & Pull Request Guidelines

Recent commits use short imperative summaries, for example `Add all 3 NID variants...` and `Remove PIN field...`. Start with a verb, keep the subject concise, and mention affected behavior.

Pull requests should include a description, extraction mode impact, configuration changes, sample command output or API evidence, and screenshots only when Swagger/API rendering changes.

## Security & Configuration Tips

Configure secrets through `.env`: `GEMINI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, optional `GEMINI_MODEL`, and `PORT`. Do not commit `service-account.json`, real NID images, generated outputs, or other PII-bearing artifacts.

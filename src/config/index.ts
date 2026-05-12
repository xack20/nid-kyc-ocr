import 'dotenv/config';

// ─── Available Gemini models ──────────────────────────────────────────────────

export const GEMINI_MODELS = {
  // Production — stable, highest capability
  'gemini-2.5-pro':           'Gemini 2.5 Pro (stable, best accuracy)',
  'gemini-3.1-pro-preview':   'Gemini 3.1 Pro Preview (latest, cutting-edge)',
  // Speed / cost tradeoff
  'gemini-2.5-flash':         'Gemini 2.5 Flash (fast, lower cost)',
  'gemini-3-flash-preview':   'Gemini 3 Flash Preview (fast, latest)',
} as const;

export type GeminiModel = keyof typeof GEMINI_MODELS;

/** Default model used when GEMINI_MODEL env var is not set. */
export const DEFAULT_MODEL: GeminiModel = 'gemini-3.1-pro-preview';

// ─── Config ───────────────────────────────────────────────────────────────────

function resolveModel(): GeminiModel {
  const env = process.env.GEMINI_MODEL;
  if (!env) return DEFAULT_MODEL;
  if (env in GEMINI_MODELS) return env as GeminiModel;
  console.warn(`[config] Unknown GEMINI_MODEL="${env}". Falling back to "${DEFAULT_MODEL}".`);
  return DEFAULT_MODEL;
}

export const config = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    model:  resolveModel(),
  },
  google: {
    credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  },
  server: {
    port: parseInt(process.env.PORT ?? '3000', 10),
  },
  upload: {
    maxFileSizeBytes: 10 * 1024 * 1024,
  },
} as const;

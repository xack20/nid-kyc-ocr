import 'dotenv/config';

// ─── Available Gemini models ──────────────────────────────────────────────────

export const GEMINI_MODELS = {
  // Production — stable, highest capability
  'gemini-2.5-pro':           'Gemini 2.5 Pro (stable, best accuracy)',
  'gemini-3.1-pro-preview':   'Gemini 3.1 Pro Preview (latest, cutting-edge)',
  // Speed / cost tradeoff
  'gemini-3.1-flash-lite':    'Gemini 3.1 Flash Lite (fast, lightweight)',
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

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export const config = {
  gemini: {
    apiKey:        process.env.GEMINI_API_KEY ?? '',
    model:         resolveModel(),
    thinkingLevel: (process.env.GEMINI_THINKING_LEVEL ?? 'high') as ThinkingLevel,
  },
  smart: {
    tier1Model:             (process.env.SMART_TIER1_MODEL ?? 'gemini-3.1-flash-lite') as GeminiModel,
    tier2Model:             (process.env.SMART_TIER2_MODEL ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL) as GeminiModel,
    tier2ThinkingLevel:     (process.env.SMART_TIER2_THINKING_LEVEL ?? 'medium') as ThinkingLevel,
    cvConfidenceThreshold:  parseFloat(process.env.SMART_CV_CONF_THRESHOLD ?? '0.85'),
    maxTier2Fields:         parseInt(process.env.SMART_MAX_TIER2_FIELDS ?? '8', 10),
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

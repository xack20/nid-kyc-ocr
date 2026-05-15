import type { NidResult } from './models.js';
import type { TimingSummary } from './timer.js';

// ─── Extraction mode ──────────────────────────────────────────────────────────

export const EXTRACTION_MODES = [
  'gemini_only',
  'vision_only',
  'vision_to_gemini',        // CV text → Gemini text-only (no image sent to Gemini)
  'vision_fed_gemini',
  'gemini_with_vision_tool',
  'combined',
  'smart',
] as const;

export type ExtractionMode = (typeof EXTRACTION_MODES)[number];

// ─── Image input ──────────────────────────────────────────────────────────────

export interface NidImage {
  buffer:   Buffer;
  mimeType: string;
  side:     'front' | 'back' | 'unknown';
}

// ─── Vision output ────────────────────────────────────────────────────────────

export interface VisionOutput {
  side:      NidImage['side'];
  rawText:   string;
  timingMs:  number;
}

// ─── Token usage ─────────────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens:   number;
  outputTokens:  number;
  totalTokens:   number;
  /** Thinking tokens — only non-zero on reasoning models. */
  thoughtTokens: number;
}

// ─── Extraction result ────────────────────────────────────────────────────────

export interface ExtractionResult {
  mode:             ExtractionMode;
  /** Structured NID fields. undefined when mode is vision_only. */
  extraction?:      NidResult;
  visionOutputs:    VisionOutput[];
  timing:           TimingSummary;
  geminiCallCount:  number;
  /** Token usage across all Gemini calls. Zero for vision_only. */
  tokenUsage:       TokenUsage;
}

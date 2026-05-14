import { GoogleGenAI, type Interactions } from '@google/genai';
import { config } from '../config/index.js';

/**
 * Generation config for non-tool strategies (gemini_only, vision_fed_gemini, vision_to_gemini).
 * - temperature:0  → deterministic OCR output, eliminates run-to-run variance
 * - seed:42        → reproducible results for debugging
 * - thinking_summaries:'auto' is safe — single-response, no function-call loop
 */
export const generationConfig: Interactions.GenerationConfig = {
  thinking_level:     config.gemini.thinkingLevel,
  thinking_summaries: 'auto',
  temperature:        0,
  seed:               42,
};

/**
 * Generation config for tool-based strategies (gemini_with_vision_tool, combined).
 * - thinking_summaries:'none' — prevents thought stream mixing with function-call output
 * - temperature:0 + seed:42  — same determinism benefit
 */
export const generationConfigTool: Interactions.GenerationConfig = {
  thinking_level:     config.gemini.thinkingLevel,
  thinking_summaries: 'none',
  temperature:        0,
  seed:               42,
};

// ─── Singleton client ─────────────────────────────────────────────────────────

let _client: GoogleGenAI | null = null;

export function geminiClient(): GoogleGenAI {
  _client ??= new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return _client;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

/** Extracts the text content from a completed Interaction response.
 *
 * With thinking_summaries:'auto', the model may include TextContent parts
 * where thought:true (internal reasoning). We skip those and return only
 * the actual output text. Falls back to any text part if no non-thought
 * part is found.
 */
export function getResponseText(interaction: Interactions.Interaction): string {
  const modelStep = interaction.steps?.find(
    (s): s is Interactions.ModelOutputStep => s.type === 'model_output',
  );
  if (!modelStep?.content) return '';

  // Prefer non-thought text parts (actual model output).
  // thought flag lives on the underlying Part type, not Interactions.TextContent,
  // so we cast through unknown to check it.
  const outputPart = modelStep.content.find(
    (c): c is Interactions.TextContent =>
      c.type === 'text' && !(c as unknown as { thought?: boolean }).thought,
  );
  if (outputPart?.text) return outputPart.text;

  // Fallback: any text part (thought flag may be undefined on older responses)
  const anyTextPart = modelStep.content.find(
    (c): c is Interactions.TextContent => c.type === 'text',
  );
  return anyTextPart?.text ?? '';
}

/** Finds the first function-call step in a requires_action response. */
export function getFunctionCallStep(
  interaction: Interactions.Interaction,
): Interactions.FunctionCallStep | undefined {
  return interaction.steps?.find(
    (s): s is Interactions.FunctionCallStep => s.type === 'function_call',
  );
}

// ─── Files API ───────────────────────────────────────────────────────────────

/**
 * Uploads an image buffer to the Gemini Files API and returns the file URI.
 *
 * Benefits vs inline base64:
 *   - Image is transmitted once; all subsequent Interactions calls reference it by URI
 *   - No re-encoding overhead on each API call
 *   - Files are free to store and auto-delete after 48 h
 *
 * @returns The file URI (e.g. "https://generativelanguage.googleapis.com/v1beta/files/abc123")
 */
export async function uploadToFilesApi(buffer: Buffer, mimeType: string): Promise<string> {
  const blob = new Blob([buffer as unknown as ArrayBuffer], { type: mimeType });
  const file = await geminiClient().files.upload({
    file:   blob,
    config: { mimeType },
  });
  if (!file.uri) throw new Error('Gemini Files API returned no URI');
  return file.uri;
}

/**
 * Deletes an uploaded file from the Files API.
 * Files auto-delete after 48 h — call this for immediate cleanup in high-volume flows.
 */
export async function deleteFromFilesApi(fileUri: string): Promise<void> {
  try {
    const name = fileUri.split('/files/')[1];
    if (name) await geminiClient().files.delete({ name: `files/${name}` });
  } catch {
    // Non-critical — file will auto-expire
  }
}

/** Accumulates token usage across multiple Interaction responses. */
export function accumulateUsage(
  interactions: Interactions.Interaction[],
): import('../core/types.js').TokenUsage {
  let inputTokens = 0, outputTokens = 0, totalTokens = 0, thoughtTokens = 0;
  for (const i of interactions) {
    inputTokens   += i.usage?.total_input_tokens   ?? 0;
    outputTokens  += i.usage?.total_output_tokens  ?? 0;
    totalTokens   += i.usage?.total_tokens         ?? 0;
    thoughtTokens += i.usage?.total_thought_tokens ?? 0;
  }
  return { inputTokens, outputTokens, totalTokens, thoughtTokens };
}

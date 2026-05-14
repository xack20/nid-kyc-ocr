import { GoogleGenAI, type Interactions } from '@google/genai';
import { config } from '../config/index.js';

/**
 * Generation config for non-tool strategies (gemini_only, vision_fed_gemini, vision_to_gemini).
 * thinking_summaries:'auto' is safe here — the model produces a single response with no
 * function-call loop to disrupt.
 */
export const generationConfig: Interactions.GenerationConfig = {
  thinking_level:     config.gemini.thinkingLevel,
  thinking_summaries: 'auto',
};

/**
 * Generation config for tool-based strategies (gemini_with_vision_tool, combined).
 * thinking_summaries must be 'none' here — when 'auto' is set in a function-call loop,
 * the model mixes its thinking stream with the final output, breaking JSON compliance.
 */
export const generationConfigTool: Interactions.GenerationConfig = {
  thinking_level:     config.gemini.thinkingLevel,
  thinking_summaries: 'none',
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

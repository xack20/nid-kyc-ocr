import { GoogleGenAI, type Interactions } from '@google/genai';
import { config } from '../config/index.js';

/** Generation config applied to every Interactions API call. */
export const generationConfig: Interactions.GenerationConfig = {
  thinking_level:    config.gemini.thinkingLevel,
  thinking_summaries: 'auto',
};

// ─── Singleton client ─────────────────────────────────────────────────────────

let _client: GoogleGenAI | null = null;

export function geminiClient(): GoogleGenAI {
  _client ??= new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return _client;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

/** Extracts the text content from a completed Interaction response. */
export function getResponseText(interaction: Interactions.Interaction): string {
  const modelStep = interaction.steps?.find(
    (s): s is Interactions.ModelOutputStep => s.type === 'model_output',
  );
  const textPart = modelStep?.content?.find(
    (c): c is Interactions.TextContent => c.type === 'text',
  );
  return textPart?.text ?? '';
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

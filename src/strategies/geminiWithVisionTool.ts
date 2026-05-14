import { type Interactions } from '@google/genai';
import { extractWithCloudVision } from '../providers/vision.js';
import { geminiClient, getResponseText, getFunctionCallStep, accumulateUsage, generationConfigTool, uploadToFilesApi, deleteFromFilesApi } from '../providers/gemini.js';
import { NID_JSON_SCHEMA } from '../utils/nidSchema.js';
import { GEMINI_WITH_VISION_TOOL_PROMPT as SYSTEM_INSTRUCTION } from '../prompts/geminiWithVisionTool.js';
import { NidResultSchema } from '../core/models.js';
import { StepTimer } from '../core/timer.js';
import { toImageMimeType } from '../utils/mime.js';
import { extractJson }       from '../utils/json.js';
import { normalizeNidJson }  from '../utils/normalize.js';
import { config } from '../config/index.js';
import type { NidImage, ExtractionResult, VisionOutput } from '../core/types.js';
import type { IExtractionStrategy } from './IExtractionStrategy.js';

/**
 * Cloud Vision is registered as a Gemini function tool.
 * Gemini decides if/when to invoke it — not pre-called.
 * Handles the requires_action loop automatically.
 */
export class GeminiWithVisionToolStrategy implements IExtractionStrategy {
  readonly mode = 'gemini_with_vision_tool' as const;

  async extract(images: NidImage[]): Promise<ExtractionResult> {
    const timer = new StepTimer();
    const visionOutputs: VisionOutput[] = [];

    // Cache Vision results keyed by side so re-calls don't hit the API twice
    const visionCache = new Map<string, string>();

    const runVision = async (side: string): Promise<string> => {
      if (visionCache.has(side)) return visionCache.get(side)!;
      const img = images.find((i) => i.side === side) ?? images[0];
      const stop = timer.start(`vision_${side}`);
      const rawText = await extractWithCloudVision(img.buffer);
      stop();
      const ms = timer.summary().steps[`vision_${side}`]?.ms ?? 0;
      visionOutputs.push({ side: img.side, rawText, timingMs: ms });
      visionCache.set(side, rawText);
      return rawText;
    };

    // Upload images once to Files API
    const stopUpload = timer.start('files_upload');
    const fileUris = await Promise.all(
      images.map(img => uploadToFilesApi(img.buffer, img.mimeType)),
    );
    stopUpload();

    const inputParts: Interactions.Content[] = [
      {
        type: 'text',
        text: 'Extract all NID fields from the image(s). Use the get_cloud_vision_ocr tool if you need precise OCR verification.',
      } satisfies Interactions.TextContent,
      ...fileUris.map((uri): Interactions.ImageContent => ({ type: 'image', uri })),
    ];

    const stopInitial = timer.start('gemini_initial');
    let interaction = await geminiClient().interactions.create({
      model:              config.gemini.model,
      system_instruction: SYSTEM_INSTRUCTION,
      generation_config:  generationConfigTool,
      // Note: response_format cannot be combined with tools — JSON is enforced
      // in the continuation call after the tool result is provided.
      input:              inputParts,
      tools: [
        {
          type:        'function',
          name:        'get_cloud_vision_ocr',
          description: 'Runs Cloud Vision Document Text Detection on a specific NID image side.',
          parameters: {
            type:       'object',
            properties: {
              side:   { type: 'string', enum: ['front', 'back', 'unknown'], description: 'Which side to OCR' },
              reason: { type: 'string', description: 'Why this verification is needed' },
            },
            required: ['side', 'reason'],
          },
        } satisfies Interactions.Function,
      ],
    });
    stopInitial();

    let geminiCallCount = 1;
    const allInteractions = [interaction];

    // Function-call loop
    while (interaction.status === 'requires_action') {
      const step = getFunctionCallStep(interaction);
      if (!step || step.name !== 'get_cloud_vision_ocr') break;

      const side = (step.arguments?.side as string | undefined) ?? 'front';
      const rawText = await runVision(side);

      const stopContinuation = timer.start(`gemini_continuation_${geminiCallCount}`);
      interaction = await geminiClient().interactions.create({
        model:                   config.gemini.model,
        generation_config:       generationConfigTool,
        response_format:         { type: 'text', mime_type: 'application/json', schema: NID_JSON_SCHEMA } satisfies Interactions.TextResponseFormat,
        previous_interaction_id: interaction.id,
        input: [
          {
            type:    'function_result',
            call_id: step.id,
            name:    step.name,
            result:  rawText,
          } satisfies Interactions.FunctionResultStep,
        ],
      });
      allInteractions.push(interaction);
      stopContinuation();
      geminiCallCount++;
    }

    const extraction = NidResultSchema.parse(normalizeNidJson(extractJson(getResponseText(interaction))));

    void Promise.all(fileUris.map(deleteFromFilesApi));

    return {
      mode:            this.mode,
      extraction,
      visionOutputs,
      timing:          timer.summary(),
      geminiCallCount,
      tokenUsage:      accumulateUsage(allInteractions),
    };
  }
}

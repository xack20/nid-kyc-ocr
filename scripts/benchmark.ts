/**
 * Benchmark: run gemini_only mode across all configured models on a single image.
 * Usage: npx tsx scripts/benchmark.ts --front <path>
 */
import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { extname, basename, join }    from 'path';
import minimist                        from 'minimist';
import { GoogleGenAI, type Interactions } from '@google/genai';
import { GEMINI_ONLY_PROMPT as SYSTEM_INSTRUCTION } from '../src/prompts/geminiOnly.js';
import { NidResultSchema }             from '../src/core/models.js';
import { StepTimer }                   from '../src/core/timer.js';
import { toImageMimeType, mimeFromExt } from '../src/utils/mime.js';
import { extractJson }                 from '../src/utils/json.js';
import { normalizeNidJson }            from '../src/utils/normalize.js';
import { ts }                          from '../src/utils/timestamp.js';
import { GEMINI_MODELS }               from '../src/config/index.js';
import type { NidResult }              from '../src/core/models.js';

const args = minimist(process.argv.slice(2), { string: ['front'] });
const frontPath: string = args['front'];

if (!frontPath) {
  console.error('Usage: npx tsx scripts/benchmark.ts --front <image-path>');
  process.exit(1);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModalityBreakdown {
  text:     number;
  image:    number;
  audio:    number;
  video:    number;
  document: number;
}

interface BenchmarkRow {
  model:         string;
  description:   string;
  timeSec:       string;
  // Input token breakdown
  inputTokens:          number;
  inputByModality:      ModalityBreakdown;
  // Output token breakdown
  outputTokens:         number;
  outputByModality:     ModalityBreakdown;
  // Other
  thoughtTokens:        number;
  totalTokens:          number;
  overall:       string;
  cardType:      string | null;
  nidNumber:     string | null;
  nameEn:        string | null;
  nameBn:        string | null;
  dateOfBirth:   string | null;
  fatherNameBn:  string | null;
  motherNameBn:  string | null;
  addressBn:     string | null;
  bloodGroup:    string | null;
  issueDate:     string | null;
  placeOfBirth:  string | null;
  error?:        string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyModality(): ModalityBreakdown {
  return { text: 0, image: 0, audio: 0, video: 0, document: 0 };
}

function parseModality(
  items?: Array<{ modality?: string; tokens?: number }>,
): ModalityBreakdown {
  const result = emptyModality();
  for (const item of items ?? []) {
    const key = item.modality as keyof ModalityBreakdown | undefined;
    if (key && key in result) result[key] += item.tokens ?? 0;
  }
  return result;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runModel(modelId: string, imageBuffer: Buffer, mimeType: string): Promise<BenchmarkRow> {
  const ai    = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const timer = new StepTimer();
  const stop  = timer.start('gemini_initial');

  let interaction: Interactions.Interaction;
  try {
    interaction = await ai.interactions.create({
      model:              modelId,
      system_instruction: SYSTEM_INSTRUCTION,
      input: [
        { type: 'text',  text: 'Extract all NID fields from the image below.' } satisfies Interactions.TextContent,
        { type: 'image', data: imageBuffer.toString('base64'), mime_type: toImageMimeType(mimeType) } satisfies Interactions.ImageContent,
      ],
    });
  } catch (err) {
    stop();
    return {
      model: modelId, description: GEMINI_MODELS[modelId as keyof typeof GEMINI_MODELS] ?? '',
      timeSec: '—',
      inputTokens: 0, inputByModality: emptyModality(),
      outputTokens: 0, outputByModality: emptyModality(),
      thoughtTokens: 0, totalTokens: 0,
      overall: '—', cardType: null, nidNumber: null, nameEn: null, nameBn: null,
      dateOfBirth: null, fatherNameBn: null, motherNameBn: null, addressBn: null,
      bloodGroup: null, issueDate: null, placeOfBirth: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  stop();

  const timing = timer.summary();
  const usage  = interaction.usage;

  const rawText = (() => {
    const step = interaction.steps?.find((s): s is Interactions.ModelOutputStep => s.type === 'model_output');
    const part = step?.content?.find((c): c is Interactions.TextContent => c.type === 'text');
    return part?.text ?? '';
  })();

  let extraction: NidResult | undefined;
  let parseError: string | undefined;
  try {
    extraction = NidResultSchema.parse(normalizeNidJson(extractJson(rawText)));
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  return {
    model:       modelId,
    description: GEMINI_MODELS[modelId as keyof typeof GEMINI_MODELS] ?? '',
    timeSec:     (timing.totalMs / 1000).toFixed(2) + 's',

    inputTokens:      usage?.total_input_tokens   ?? 0,
    inputByModality:  parseModality(usage?.input_tokens_by_modality  as Array<{ modality?: string; tokens?: number }> | undefined),

    outputTokens:     usage?.total_output_tokens  ?? 0,
    outputByModality: parseModality(usage?.output_tokens_by_modality as Array<{ modality?: string; tokens?: number }> | undefined),

    thoughtTokens: usage?.total_thought_tokens ?? 0,
    totalTokens:   usage?.total_tokens         ?? 0,

    overall:      extraction?.overallConfidence?.toUpperCase() ?? '—',
    cardType:     extraction?.cardType           ?? null,
    nidNumber:    extraction?.nidNumber.value    ?? null,
    nameEn:       extraction?.nameEn.value       ?? null,
    nameBn:       extraction?.nameBn.value       ?? null,
    dateOfBirth:  extraction?.dateOfBirth.value  ?? null,
    fatherNameBn: extraction?.fatherNameBn.value ?? null,
    motherNameBn: extraction?.motherNameBn.value ?? null,
    addressBn:    extraction?.addressBn.value    ?? null,
    bloodGroup:   extraction?.bloodGroup.value   ?? null,
    issueDate:    extraction?.issueDate.value     ?? null,
    placeOfBirth: extraction?.placeOfBirth.value   ?? null,
    error:        parseError,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const imageBuffer = await readFile(frontPath);
  const mimeType    = mimeFromExt(extname(frontPath));
  const models      = Object.keys(GEMINI_MODELS);

  console.log(`\nBenchmark: gemini_only  —  ${basename(frontPath)}`);
  console.log(`Models: ${models.join(', ')}\n`);

  const results: BenchmarkRow[] = [];

  for (const model of models) {
    process.stdout.write(`  Running ${model} ... `);
    const row = await runModel(model, imageBuffer, mimeType);
    results.push(row);
    if (row.error) {
      console.log(`ERROR: ${row.error.slice(0, 80)}`);
    } else {
      console.log(`${row.timeSec}  |  ${row.totalTokens} tokens  |  ${row.overall}`);
    }
  }

  const SEP  = '═';
  const LINE = '─';
  const W    = { model: 26, time: 8, inp: 8, out: 8, thought: 8, total: 8, overall: 8 };
  const lineW = Object.values(W).reduce((a, b) => a + b, 0) + Object.keys(W).length * 3;
  const line  = LINE.repeat(lineW);

  // ── 1. Timing & total tokens ────────────────────────────────────────────────
  console.log(`\n${SEP.repeat(lineW)}`);
  console.log('1. TIMING & TOKEN USAGE');
  console.log(line);
  console.log(
    `${'Model'.padEnd(W.model)} | ${'Time'.padStart(W.time)} | ${'In tok'.padStart(W.inp)} | ${'Out tok'.padStart(W.out)} | ${'Thought'.padStart(W.thought)} | ${'Total'.padStart(W.total)} | ${'Overall'.padEnd(W.overall)}`,
  );
  console.log(line);
  for (const r of results) {
    console.log(
      `${r.model.padEnd(W.model)} | ${r.timeSec.padStart(W.time)} | ${String(r.inputTokens).padStart(W.inp)} | ${String(r.outputTokens).padStart(W.out)} | ${String(r.thoughtTokens).padStart(W.thought)} | ${String(r.totalTokens).padStart(W.total)} | ${r.overall.padEnd(W.overall)}`,
    );
  }
  console.log(line);

  // ── 2. Input token breakdown by modality ────────────────────────────────────
  const MW   = { model: 26, text: 10, image: 10, audio: 8, video: 8, doc: 8, total: 8 };
  const mlineW = Object.values(MW).reduce((a, b) => a + b, 0) + Object.keys(MW).length * 3;
  const mline  = LINE.repeat(mlineW);

  console.log(`\n${SEP.repeat(mlineW)}`);
  console.log('2. INPUT TOKEN BREAKDOWN BY MODALITY');
  console.log(mline);
  console.log(
    `${'Model'.padEnd(MW.model)} | ${'Text'.padStart(MW.text)} | ${'Image'.padStart(MW.image)} | ${'Audio'.padStart(MW.audio)} | ${'Video'.padStart(MW.video)} | ${'Doc'.padStart(MW.doc)} | ${'Total'.padStart(MW.total)}`,
  );
  console.log(mline);
  for (const r of results) {
    const b = r.inputByModality;
    console.log(
      `${r.model.padEnd(MW.model)} | ${String(b.text).padStart(MW.text)} | ${String(b.image).padStart(MW.image)} | ${String(b.audio).padStart(MW.audio)} | ${String(b.video).padStart(MW.video)} | ${String(b.document).padStart(MW.doc)} | ${String(r.inputTokens).padStart(MW.total)}`,
    );
  }
  console.log(mline);

  // ── 3. Output token breakdown by modality ───────────────────────────────────
  console.log(`\n${SEP.repeat(mlineW)}`);
  console.log('3. OUTPUT TOKEN BREAKDOWN BY MODALITY');
  console.log(mline);
  console.log(
    `${'Model'.padEnd(MW.model)} | ${'Text'.padStart(MW.text)} | ${'Image'.padStart(MW.image)} | ${'Audio'.padStart(MW.audio)} | ${'Video'.padStart(MW.video)} | ${'Doc'.padStart(MW.doc)} | ${'Total'.padStart(MW.total)}`,
  );
  console.log(mline);
  for (const r of results) {
    const b = r.outputByModality;
    console.log(
      `${r.model.padEnd(MW.model)} | ${String(b.text).padStart(MW.text)} | ${String(b.image).padStart(MW.image)} | ${String(b.audio).padStart(MW.audio)} | ${String(b.video).padStart(MW.video)} | ${String(b.document).padStart(MW.doc)} | ${String(r.outputTokens).padStart(MW.total)}`,
    );
  }
  console.log(mline);

  // ── 4. Extraction diff ──────────────────────────────────────────────────────
  const FW      = { field: 14, val: 28 };
  const flineW  = FW.field + 3 + models.length * (FW.val + 3);
  const fline   = LINE.repeat(flineW);

  console.log(`\n${SEP.repeat(flineW)}`);
  console.log('4. EXTRACTION DIFF');
  console.log(fline);
  let header = 'Field'.padEnd(FW.field);
  for (const r of results) header += ` | ${r.model.padEnd(FW.val)}`;
  console.log(header);
  console.log(fline);

  const fields: Array<{ label: string; key: keyof BenchmarkRow }> = [
    { label: 'Card Type',     key: 'cardType'     },
    { label: 'NID Number',    key: 'nidNumber'    },
    { label: 'Name (EN)',     key: 'nameEn'       },
    { label: 'Name (BN)',     key: 'nameBn'       },
    { label: 'Date of Birth', key: 'dateOfBirth'  },
    { label: 'Father (BN)',   key: 'fatherNameBn' },
    { label: 'Mother (BN)',   key: 'motherNameBn' },
    { label: 'Address (BN)',  key: 'addressBn'    },
    { label: 'Blood Group',   key: 'bloodGroup'   },
    { label: 'Issue Date',    key: 'issueDate'    },
    { label: 'Place of Birth', key: 'placeOfBirth' },
    { label: 'Overall',       key: 'overall'      },
  ];

  for (const { label, key } of fields) {
    let row = label.padEnd(FW.field);
    for (const r of results) {
      const val = r[key] ?? (r.error ? 'ERROR' : 'N/A');
      row += ` | ${String(val).slice(0, FW.val).padEnd(FW.val)}`;
    }
    console.log(row);
  }
  console.log(fline);

  // ── Save ────────────────────────────────────────────────────────────────────
  const OUTPUT_DIR = './outputs';
  await mkdir(OUTPUT_DIR, { recursive: true });
  const outFile = join(OUTPUT_DIR, `benchmark_gemini_only_${ts()}.json`);
  await writeFile(outFile, JSON.stringify({ image: frontPath, mode: 'gemini_only', results }, null, 2), 'utf-8');
  console.log(`\nFull results saved → ${outFile}`);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});

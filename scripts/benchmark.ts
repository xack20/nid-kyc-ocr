/**
 * Benchmark: run gemini_only mode across all configured models on a single image.
 * Usage: npx tsx scripts/benchmark.ts --front <path>
 */
import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { extname, basename, join }    from 'path';
import minimist                        from 'minimist';
import { GoogleGenAI, type Interactions } from '@google/genai';
import { SYSTEM_INSTRUCTION }          from '../src/prompts/system.js';
import { NidResultSchema }             from '../src/core/models.js';
import { StepTimer }                   from '../src/core/timer.js';
import { toImageMimeType, mimeFromExt } from '../src/utils/mime.js';
import { extractJson }                 from '../src/utils/json.js';
import { ts }                          from '../src/utils/timestamp.js';
import { GEMINI_MODELS }               from '../src/config/index.js';
import type { TokenUsage }             from '../src/core/types.js';
import type { NidResult }              from '../src/core/models.js';

const args = minimist(process.argv.slice(2), { string: ['front'] });
const frontPath: string = args['front'];

if (!frontPath) {
  console.error('Usage: npx tsx scripts/benchmark.ts --front <image-path>');
  process.exit(1);
}

interface BenchmarkRow {
  model:         string;
  description:   string;
  timeSec:       string;
  inputTokens:   number;
  outputTokens:  number;
  totalTokens:   number;
  thoughtTokens: number;
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
  pin:           string | null;
  error?:        string;
}

async function runModel(
  modelId: string,
  imageBuffer: Buffer,
  mimeType: string,
): Promise<BenchmarkRow> {
  const ai    = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const timer = new StepTimer();

  const stop = timer.start('gemini_initial');
  let interaction: Interactions.Interaction;

  try {
    interaction = await ai.interactions.create({
      model:              modelId,
      system_instruction: SYSTEM_INSTRUCTION,
      input: [
        { type: 'text', text: 'Extract all NID fields from the image below.' } satisfies Interactions.TextContent,
        { type: 'image', data: imageBuffer.toString('base64'), mime_type: toImageMimeType(mimeType) } satisfies Interactions.ImageContent,
      ],
    });
  } catch (err) {
    stop();
    return {
      model: modelId, description: GEMINI_MODELS[modelId as keyof typeof GEMINI_MODELS] ?? '',
      timeSec: '—', inputTokens: 0, outputTokens: 0, totalTokens: 0, thoughtTokens: 0,
      overall: '—', cardType: null, nidNumber: null, nameEn: null, nameBn: null,
      dateOfBirth: null, fatherNameBn: null, motherNameBn: null, addressBn: null,
      bloodGroup: null, issueDate: null, pin: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  stop();

  const timing   = timer.summary();
  const usage    = interaction.usage;
  const rawText  = (() => {
    const step = interaction.steps?.find((s): s is Interactions.ModelOutputStep => s.type === 'model_output');
    const part = step?.content?.find((c): c is Interactions.TextContent => c.type === 'text');
    return part?.text ?? '';
  })();

  let extraction: NidResult | undefined;
  let parseError: string | undefined;
  try {
    extraction = NidResultSchema.parse(extractJson(rawText));
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  return {
    model:         modelId,
    description:   GEMINI_MODELS[modelId as keyof typeof GEMINI_MODELS] ?? '',
    timeSec:       (timing.totalMs / 1000).toFixed(2) + 's',
    inputTokens:   usage?.total_input_tokens   ?? 0,
    outputTokens:  usage?.total_output_tokens  ?? 0,
    totalTokens:   usage?.total_tokens         ?? 0,
    thoughtTokens: usage?.total_thought_tokens ?? 0,
    overall:       extraction?.overallConfidence?.toUpperCase() ?? '—',
    cardType:      extraction?.cardType      ?? null,
    nidNumber:     extraction?.nidNumber.value    ?? null,
    nameEn:        extraction?.nameEn.value        ?? null,
    nameBn:        extraction?.nameBn.value        ?? null,
    dateOfBirth:   extraction?.dateOfBirth.value   ?? null,
    fatherNameBn:  extraction?.fatherNameBn.value  ?? null,
    motherNameBn:  extraction?.motherNameBn.value  ?? null,
    addressBn:     extraction?.addressBn.value     ?? null,
    bloodGroup:    extraction?.bloodGroup.value    ?? null,
    issueDate:     extraction?.issueDate.value     ?? null,
    pin:           extraction?.pin.value           ?? null,
    error:         parseError,
  };
}

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
      console.log(`ERROR: ${row.error}`);
    } else {
      console.log(`${row.timeSec}  |  ${row.totalTokens} tokens  |  ${row.overall}`);
    }
  }

  // ── Timing & tokens table ──────────────────────────────────────────────────
  const W = { model: 26, time: 8, inp: 8, out: 8, thought: 8, total: 8, overall: 8 };
  const line = '─'.repeat(Object.values(W).reduce((a, b) => a + b, 0) + Object.keys(W).length * 3);

  console.log(`\n${'═'.repeat(line.length)}`);
  console.log('TIMING & TOKEN USAGE');
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

  // ── Extraction diff table ──────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(line.length)}`);
  console.log('EXTRACTION DIFF');
  console.log(line);
  const FW = { field: 14, val: 28 };
  const fieldLine = '─'.repeat(FW.field + 3 + models.length * (FW.val + 3));

  // Header
  let header = 'Field'.padEnd(FW.field);
  for (const r of results) header += ` | ${r.model.padEnd(FW.val)}`;
  console.log(header);
  console.log(fieldLine);

  const fields: Array<{ label: string; key: keyof BenchmarkRow }> = [
    { label: 'Card Type',     key: 'cardType'    },
    { label: 'NID Number',    key: 'nidNumber'   },
    { label: 'Name (EN)',     key: 'nameEn'      },
    { label: 'Name (BN)',     key: 'nameBn'      },
    { label: 'Date of Birth', key: 'dateOfBirth' },
    { label: 'Father (BN)',   key: 'fatherNameBn' },
    { label: 'Mother (BN)',   key: 'motherNameBn' },
    { label: 'Address (BN)',  key: 'addressBn'   },
    { label: 'Blood Group',   key: 'bloodGroup'  },
    { label: 'Issue Date',    key: 'issueDate'   },
    { label: 'PIN',           key: 'pin'         },
    { label: 'Overall',       key: 'overall'     },
  ];

  for (const { label, key } of fields) {
    let row = label.padEnd(FW.field);
    for (const r of results) {
      const val = r[key] ?? (r.error ? 'ERROR' : 'N/A');
      row += ` | ${String(val).slice(0, FW.val).padEnd(FW.val)}`;
    }
    console.log(row);
  }
  console.log(fieldLine);

  // ── Save output ────────────────────────────────────────────────────────────
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

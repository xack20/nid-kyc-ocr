// ─── Types ────────────────────────────────────────────────────────────────────

export interface StepTiming {
  ms:        number;
  formatted: string;
  /** Present when the same step name was recorded more than once (e.g. repeated Gemini calls). */
  callCount?: number;
}

export interface TimingSummary {
  steps:         Record<string, StepTiming>;
  /** Sum of all vision_* step durations. */
  visionTotalMs: number;
  /** Sum of all gemini_* step durations. */
  geminiTotalMs: number;
  totalMs:       number;
  totalFormatted: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

// ─── StepTimer ────────────────────────────────────────────────────────────────

export class StepTimer {
  private readonly requestStart = Date.now();
  private readonly log: Array<{ name: string; ms: number }> = [];

  /**
   * Starts timing a named step.
   * Returns a stop function — call it when the step finishes.
   * The same name may be used multiple times (e.g. repeated Gemini calls).
   *
   * @example
   * const stop = timer.start('vision_front');
   * await doWork();
   * stop();
   */
  start(name: string): () => void {
    const begin = Date.now();
    return () => {
      this.log.push({ name, ms: Date.now() - begin });
    };
  }

  /** Build the final summary. Call once after all steps are complete. */
  summary(): TimingSummary {
    const accumulated: Record<string, { total: number; count: number }> = {};

    for (const { name, ms } of this.log) {
      const entry = accumulated[name] ?? { total: 0, count: 0 };
      entry.total += ms;
      entry.count += 1;
      accumulated[name] = entry;
    }

    const steps: Record<string, StepTiming> = {};
    let visionTotalMs = 0;
    let geminiTotalMs = 0;

    for (const [name, { total, count }] of Object.entries(accumulated)) {
      steps[name] = {
        ms:        total,
        formatted: fmt(total),
        ...(count > 1 ? { callCount: count } : {}),
      };
      if (name.startsWith('vision_')) visionTotalMs += total;
      if (name.startsWith('gemini_')) geminiTotalMs += total;
    }

    const totalMs = Date.now() - this.requestStart;
    return { steps, visionTotalMs, geminiTotalMs, totalMs, totalFormatted: fmt(totalMs) };
  }
}

/** Returns a filesystem-safe timestamp string, e.g. "2026-05-12_10-36-46" */
export function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

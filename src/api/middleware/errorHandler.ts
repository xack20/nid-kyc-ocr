import type { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const message = err instanceof Error ? err.message : 'An unexpected error occurred';
  const status  = (err as { status?: number }).status ?? 500;
  res.status(status).json({ success: false, error: message });
}

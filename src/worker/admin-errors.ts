import type { ErrorHandler } from 'hono';
import type { AppEnv } from './env';
import { ValidationError } from '../shared/commission';
import { NotFoundError, RepoError } from './repo';

/** Thrown by staff routes for a plain client error: { error } with the given status. */
export class HttpError extends Error {
  constructor(public status: 400 | 403 | 404 | 503, message: string, public fields?: Record<string, string>) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFoundPartner = () => new HttpError(404, '找不到伙伴');

/** Shared `onError` for the staff API: repo outages are 503, missing rows 404, HttpError as given. */
export const adminErrorHandler: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof HttpError) {
    return c.json(err.fields ? { error: err.message, fields: err.fields } : { error: err.message }, err.status);
  }
  if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
  if (err instanceof RepoError) return c.json({ error: '数据库暂时无法连接，请稍后再试' }, 503);
  if (err instanceof NotFoundError) return c.json({ error: '找不到伙伴' }, 404);
  console.error(err);
  return c.json({ error: '服务器出错了，请稍后再试' } as { error: string }, 500);
};

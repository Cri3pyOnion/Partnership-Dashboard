import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import { requireStaff } from './access';
import type { AppEnv, Env } from './env';
import { lazyRepo } from './lazy-repo';
import type { Repo } from './repo';
import { partnerView } from './routes/partner-view';
import { SupabaseRepo } from './supabase-repo';

export function createApp(deps: { makeRepo?: (env: Env) => Repo; jwks?: JWTVerifyGetKey } = {}): Hono<AppEnv> {
  const makeRepo = deps.makeRepo ?? ((env: Env) => new SupabaseRepo(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY));
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('repo', lazyRepo(() => makeRepo(c.env)));
    await next();
  });

  app.route('/', partnerView);

  app.get('/api/admin/me', requireStaff({ jwks: deps.jwks }), (c) => {
    const { email, name, role, team } = c.var.staff;
    return c.json({ email, name, role, team });
  });

  return app;
}

let app: Hono<AppEnv> | undefined;

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => (app ??= createApp()).fetch(req, env, ctx),
};

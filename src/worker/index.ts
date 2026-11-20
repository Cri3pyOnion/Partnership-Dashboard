import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import { requireStaff } from './access';
import { staffCsrf } from './csrf';
import type { AppEnv, Env } from './env';
import { lazyRepo } from './lazy-repo';
import type { Repo } from './repo';
import { adminApp } from './routes/admin-app';
import { adminCases } from './routes/admin-cases';
import { adminDocuments } from './routes/admin-documents';
import { adminCommissions } from './routes/admin-commissions';
import { adminPartners } from './routes/admin-partners';
import { adminReports, adminStatements } from './routes/admin-reports';
import { adminLicenceTypes, adminSettings, adminStaff, adminStaffDirectory } from './routes/admin-settings';
import { partnerView } from './routes/partner-view';
import { type DocStorage, SupabaseStorage, lazyStorage } from './storage';
import { SupabaseRepo } from './supabase-repo';

export function createApp(deps: { makeRepo?: (env: Env) => Repo; makeStorage?: (env: Env) => DocStorage; jwks?: JWTVerifyGetKey } = {}): Hono<AppEnv> {
  const makeRepo = deps.makeRepo ?? ((env: Env) => new SupabaseRepo(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY));
  const makeStorage = deps.makeStorage ?? ((env: Env) => new SupabaseStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY));
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('repo', lazyRepo(() => makeRepo(c.env)));
    c.set('storage', lazyStorage(() => makeStorage(c.env)));
    await next();
  });

  app.route('/', partnerView);
  app.route('/', adminApp);

  // Before any staff route: a write from another site is refused before auth or the repo.
  app.use('/api/admin/*', ...staffCsrf());

  app.get('/api/admin/me', requireStaff({ jwks: deps.jwks }), (c) => {
    const { email, name, role, team } = c.var.staff;
    return c.json({ email, name, role, team });
  });

  app.route('/api/admin/partners', adminPartners(deps.jwks));
  app.route('/api/admin', adminDocuments(deps.jwks));
  app.route('/api/admin/cases', adminCases(deps.jwks));
  app.route('/api/admin/commissions', adminCommissions(deps.jwks));
  app.route('/api/admin/settings', adminSettings(deps.jwks));
  app.route('/api/admin/staff', adminStaff(deps.jwks));
  app.route('/api/admin/licence-types', adminLicenceTypes(deps.jwks));
  app.route('/api/admin/staff-directory', adminStaffDirectory(deps.jwks));
  app.route('/api/admin/reports', adminReports(deps.jwks));
  app.route('/api/admin/statements', adminStatements(deps.jwks));

  return app;
}

let app: Hono<AppEnv> | undefined;

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => (app ??= createApp()).fetch(req, env, ctx),
};

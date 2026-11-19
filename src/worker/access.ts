import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env';
import { RepoError } from './repo';

const jwksByTeam = new Map<string, JWTVerifyGetKey>();

/** One remote JWKS per team domain, cached for the life of the isolate (jose also caches the keys). */
function remoteJwks(teamDomain: string): JWTVerifyGetKey {
  let jwks = jwksByTeam.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeam.set(teamDomain, jwks);
  }
  return jwks;
}

/**
 * Verifies the Cloudflare Access JWT, loads the active staff member by the token's email and
 * sets `c.var.staff`. Needs `c.var.repo` to be set by an earlier middleware.
 */
export function requireStaff(opts: { role?: 'admin'; jwks?: JWTVerifyGetKey } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token) return c.json({ error: '未登录' }, 401);

    let email: string;
    try {
      const jwks = opts.jwks ?? remoteJwks(c.env.ACCESS_TEAM_DOMAIN);
      const { payload } = await jwtVerify(token, jwks, {
        audience: c.env.ACCESS_AUD,
        issuer: `https://${c.env.ACCESS_TEAM_DOMAIN}`,
      });
      if (typeof payload.email !== 'string' || payload.email === '') return c.json({ error: '未登录' }, 401);
      email = payload.email.toLowerCase();
    } catch {
      return c.json({ error: '未登录' }, 401);
    }

    let staff;
    try {
      staff = await c.get('repo').getStaff(email);
    } catch (err) {
      if (err instanceof RepoError) return c.json({ error: '数据库暂时无法连接，请稍后再试' }, 503);
      throw err;
    }
    if (!staff || !staff.active) return c.json({ error: '没有权限' }, 403);
    if (opts.role === 'admin' && staff.role !== 'admin') return c.json({ error: '没有权限' }, 403);

    c.set('staff', staff);
    await next();
  };
}

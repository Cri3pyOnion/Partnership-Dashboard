// Shared setup for the staff API tests (cases, commissions, settings, reports).
import { env as testEnv } from 'cloudflare:workers';
import type { JWTVerifyGetKey } from 'jose';
import type { PartnerCode, Staff } from '../../src/shared/types';
import type { Env } from '../../src/worker/env';
import { createApp } from '../../src/worker/index';
import { newViewToken } from '../../src/worker/token';
import { FakeRepo } from '../fake-repo';
import { FakeStorage } from '../fake-storage';
import { partnerInput } from '../repo/repo.contract';
import { AUD, TEAM, makeAccess } from './access-helper';

export const ENV = { ...(testEnv as unknown as Env), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } as Env;
export const DB_DOWN = { error: '数据库暂时无法连接，请稍后再试' };
export const admin: Staff = { email: 'boss@tohsign.com', name: 'Boss', role: 'admin', team: 'IT', active: true };
export const clerk: Staff = { email: 'clerk@tohsign.com', name: 'Clerk', role: 'staff', team: '市场部', active: true };

let sign: (email: string) => Promise<string>;
let jwks: JWTVerifyGetKey;
let ready: Promise<void> | undefined;
async function init() {
  ready ??= makeAccess().then((a) => {
    sign = a.sign;
    jwks = a.jwks;
  });
  await ready;
}

export async function setupAdmin(repo: FakeRepo = new FakeRepo(), storage: FakeStorage = new FakeStorage()) {
  await init();
  await repo.saveStaff(admin, 't');
  await repo.saveStaff(clerk, 't');
  const app = createApp({ makeRepo: () => repo, makeStorage: () => storage, jwks });
  async function req(who: Staff | null, method: string, path: string, json?: unknown, env: Env = ENV) {
    const headers: Record<string, string> = {};
    if (who) headers['Cf-Access-Jwt-Assertion'] = await sign(who.email);
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    return app.request(path, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) }, env);
  }
  /** A request with a raw body (file uploads). */
  async function rawReq(who: Staff | null, method: string, path: string, body: BodyInit | undefined, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { ...headers };
    if (who) h['Cf-Access-Jwt-Assertion'] = await sign(who.email);
    return app.request(path, { method, headers: h, body }, ENV);
  }
  /** An approved partner that has a page link. */
  async function activePartner(code: PartnerCode = 'A1', over: Record<string, unknown> = {}) {
    const p = await repo.createPartner(partnerInput({ code, ...over }), 't');
    const token = newViewToken();
    await repo.updatePartner(p.id, { status: '活跃', viewToken: token }, 't');
    return { id: p.id, token };
  }
  const json = async (res: Response) => (await res.json()) as any;
  return { repo, storage, app, req, rawReq, activePartner, json };
}

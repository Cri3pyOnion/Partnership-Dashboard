import type { Repo } from './repo';
import type { Staff } from '../shared/types';

export type Env = {
  VIEWS: KVNamespace;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MARKETING_WHATSAPP: string;
};

/** Hono environment shared by every route: bindings plus request-scoped variables. */
export type AppEnv = { Bindings: Env; Variables: { repo: Repo; staff: Staff } };

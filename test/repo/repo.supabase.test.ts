import { describe } from 'vitest';
import { SupabaseRepo } from '../../src/worker/supabase-repo';
import { runRepoContract } from './repo.contract';

// Runs only against a real (dev) Supabase project with the migration applied:
//   SUPABASE_TEST_URL=https://xxx.supabase.co SUPABASE_TEST_KEY=<service role key> npm test -- repo.supabase
describe.skipIf(!process.env.SUPABASE_TEST_URL)('SupabaseRepo (live)', () => {
  runRepoContract(async () => new SupabaseRepo(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_KEY!));
});

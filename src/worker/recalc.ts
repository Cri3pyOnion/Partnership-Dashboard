// Commission recalculation after a case change.
import { applyCommission, calcCommission, isFrozen, previewCommission } from '../shared/commission';
import type { Case, Commission, CommissionRules, Partner, PartnerCode } from '../shared/types';
import { refreshOrDrop } from './admin-support';
import type { Env } from './env';
import { NotFoundError } from './repo';
import type { Repo } from './repo';

/** Options for a recalculation. `unsettle`: the write explicitly set clientPaid false (see isFrozen). */
export interface RecalcOptions {
  unsettle?: boolean;
}

/**
 * The commission a case would have. A paid (已支付) or settled (已结清) commission is returned as it
 * is (never recalculated), except a 已结清 row when `opts.unsettle`. Throws ValidationError when the
 * markup is over the cap. Pure, so routes can call it to validate a change before committing it.
 */
export function nextCommission(
  c: Pick<Case, 'price' | 'markup' | 'clientPaid' | 'cancelled'>,
  caseId: string,
  partnerCode: PartnerCode,
  existing: Commission | null,
  rules: CommissionRules,
  opts: RecalcOptions = {},
): Commission {
  if (existing && isFrozen(existing, opts)) return existing;
  const code = existing?.code ?? partnerCode;
  return applyCommission(caseId, existing, calcCommission(c, code, rules), code, opts);
}

/**
 * Recalculate and save the commission of a case, then rebuild the partner's page.
 * The commission keeps the code it was first calculated with; a new one uses the partner's code.
 */
export async function recalcCase(env: Env, repo: Repo, caseId: string, opts: RecalcOptions = {}): Promise<Commission> {
  const c = await repo.getCase(caseId);
  if (!c) throw new NotFoundError(`case ${caseId} not found`);
  const [partner, settings, existing] = await Promise.all([
    repo.getPartner(c.partnerId), repo.getSettings(), repo.getCommission(caseId),
  ]);
  if (!partner) throw new NotFoundError(`partner ${c.partnerId} not found`);
  const next = nextCommission(c, caseId, partner.code, existing, settings.commissionRules, opts);
  if (next !== existing) await repo.saveCommission(next);
  await refreshOrDrop(env, repo, partner.id, partner.viewToken);
  return next;
}

export { previewCommission };

/**
 * Recalculate after a committed write without ever failing the response (R32). On failure the page
 * is still rebuilt and the caller gets the preview, marked pending; the next write repairs the row.
 */
export async function recalcAfterCommit(
  env: Env, repo: Repo, saved: Case, partner: Pick<Partner, 'id' | 'code' | 'viewToken'>,
  existing: Commission | null, rules: CommissionRules, opts: RecalcOptions = {},
): Promise<{ commission: Commission; commissionPending?: true }> {
  try {
    return { commission: await recalcCase(env, repo, saved.id, opts) };
  } catch (err) {
    console.error('recalcCase failed:', err instanceof Error ? err.message : 'unknown');
  }
  await refreshOrDrop(env, repo, partner.id, partner.viewToken);
  const commission = nextCommissionSafe(saved, partner.code, existing, rules, opts);
  return { commission, commissionPending: true };
}

function nextCommissionSafe(
  c: Case, code: PartnerCode, existing: Commission | null, rules: CommissionRules, opts: RecalcOptions,
): Commission {
  try {
    return nextCommission(c, c.id, code, existing, rules, opts);
  } catch {
    return existing as Commission;
  }
}

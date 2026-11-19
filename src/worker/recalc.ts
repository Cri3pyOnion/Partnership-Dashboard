// Commission recalculation after a case change.
import { applyCommission, calcCommission } from '../shared/commission';
import type { Case, Commission, CommissionRules, PartnerCode } from '../shared/types';
import { refreshOrDrop } from './admin-support';
import type { Env } from './env';
import { NotFoundError } from './repo';
import type { Repo } from './repo';

/**
 * The commission a case would have. A paid commission is returned as it is (never recalculated).
 * Throws ValidationError when the markup is over the cap. Pure, so routes can call it to validate
 * a change before committing it.
 */
export function nextCommission(
  c: Pick<Case, 'price' | 'markup' | 'clientPaid' | 'cancelled'>,
  caseId: string,
  partnerCode: PartnerCode,
  existing: Commission | null,
  rules: CommissionRules,
): Commission {
  if (existing?.status === '已支付') return existing;
  const code = existing?.code ?? partnerCode;
  return applyCommission(caseId, existing, calcCommission(c, code, rules), code);
}

/**
 * Recalculate and save the commission of a case, then rebuild the partner's page.
 * The commission keeps the code it was first calculated with; a new one uses the partner's code.
 */
export async function recalcCase(env: Env, repo: Repo, caseId: string): Promise<Commission> {
  const c = await repo.getCase(caseId);
  if (!c) throw new NotFoundError(`case ${caseId} not found`);
  const [partner, settings, existing] = await Promise.all([
    repo.getPartner(c.partnerId), repo.getSettings(), repo.getCommission(caseId),
  ]);
  if (!partner) throw new NotFoundError(`partner ${c.partnerId} not found`);
  const next = nextCommission(c, caseId, partner.code, existing, settings.commissionRules);
  if (next !== existing) await repo.saveCommission(next);
  await refreshOrDrop(env, repo, partner.id, partner.viewToken);
  return next;
}

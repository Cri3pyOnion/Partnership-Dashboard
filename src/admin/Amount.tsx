import { rm } from '../shared/money';

export const B1_LABEL = "应付 Toh's Sign";
export const B1_NOTE = "B1 金额为伙伴应付 Toh's Sign 的款项";
export const PENDING_LABEL = '佣金待计算';

/** A commission amount. A B1 amount is what the partner owes Toh's Sign, so it says so. */
export function Amount({ amount, code, pending }: { amount: number; code?: string; pending?: boolean }) {
  return (
    <>
      {rm(amount)}
      {code === 'B1' && <span className="tag b1">{B1_LABEL}</span>}
      {pending && <span className="tag pending">{PENDING_LABEL}</span>}
    </>
  );
}

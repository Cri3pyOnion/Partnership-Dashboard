import { CASE_STEPS, STEP_CANCELLED } from './status';
import type { Case, Partner } from './types';

/** wa.me link for a phone number with prefilled text; '' when the number has no digits. */
export function whatsappLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** The message staff send a partner with their private page link. */
export function linkMessage(p: Pick<Partner, 'name'>, link: string): string {
  return `您好 ${p.name}，这是您的 Toh's Sign 伙伴专属页面（只读）：${link}`;
}

/** The progress message staff send a partner for one case, with the partner's page link. */
export function caseUpdateMessage(c: Pick<Case, 'id' | 'clientName' | 'step' | 'cancelled'>, link: string): string {
  const step = c.cancelled ? STEP_CANCELLED : CASE_STEPS[c.step];
  return `案件 ${c.id}（${c.clientName}）进度更新：${step}。查看：${link}`;
}

/** The nudge staff send a partner who has gone quiet. */
export function inactiveMessage(p: Pick<Partner, 'name'>): string {
  return `您好 ${p.name}，好久不见！Toh's Sign 最近有新服务，欢迎随时联系我们。`;
}

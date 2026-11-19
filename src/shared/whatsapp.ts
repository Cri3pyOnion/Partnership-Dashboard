import type { Partner } from './types';

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

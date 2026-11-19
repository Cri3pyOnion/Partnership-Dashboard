export function normalizePhone(s: string): string | null {
  const t = s.trim().replace(/^\+60/, '').trim().replace(/^0/, '');
  if (!/^1[0-9][0-9 -]{6,10}$/.test(t)) return null;
  return '+60' + t.replace(/[^0-9]/g, '');
}

export function normalizeTin(s: string): string | null {
  const t = s.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{1,2}[0-9]{8,12}$/.test(t) ? t : null;
}

export function isEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

export function formatPartnerId(n: number): string {
  return `TSP${String(n).padStart(4, '0')}`;
}

export function formatCaseId(date: Date, n: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const yy = get('year').slice(-2);
  return `TS-${yy}${get('month')}-${String(n).padStart(3, '0')}`;
}

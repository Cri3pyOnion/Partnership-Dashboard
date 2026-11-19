const TZ = 'Asia/Kuala_Lumpur';

/** 2026-11-03 in Kuala Lumpur time; the input is returned as-is when it is not a date. */
export function klDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** 2026-11-03 14:05 in Kuala Lumpur time. */
export function klDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString('en-CA', { timeZone: TZ });
  const time = d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

export function formatRelative(thenMs: number, nowMs: number): string {
  const diff = nowMs - thenMs;
  if (diff < 45_000) return 'just now';
  if (diff < HOUR) return rtf.format(-Math.max(1, Math.floor(diff / MIN)), 'minute');
  if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), 'hour');
  if (diff <= 7 * DAY) return rtf.format(-Math.floor(diff / DAY), 'day');
  return dateFmt.format(new Date(thenMs));
}

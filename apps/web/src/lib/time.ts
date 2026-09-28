const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today at 3:04 PM", "Yesterday at ...", or "9/6/26, 3:04 PM" (Discord's author-line format). */
export function formatMessageTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay(d, now)) return `Today at ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })}, ${time}`;
}

export const formatShortTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export const formatFullDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const formatDayDivider = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

export const isSameDay = (a: string, b: string) => sameDay(new Date(a), new Date(b));

/** Messages from the same author within 7 minutes on the same day render as one group. */
export const GROUP_WINDOW_MS = 7 * 60 * 1000;

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;

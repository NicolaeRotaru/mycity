export type HoursInterval = [string, string];
export type StoreHours = Partial<
  Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', HoursInterval[]>
>;

export const DAY_KEYS: (keyof StoreHours)[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function streetFromAddress(address?: string | null): string | null {
  if (!address) return null;
  const street = address.split(',')[0]?.trim();
  return street && street.length > 0 ? street : null;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function isOpenNow(intervals?: HoursInterval[], now: Date = new Date()): boolean {
  if (!intervals || intervals.length === 0) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return intervals.some(([open, close]) => {
    const o = toMinutes(open);
    const c = toMinutes(close);
    return minutes >= o && minutes < c;
  });
}

export function formatToday(intervals?: HoursInterval[], now: Date = new Date()): string {
  if (!intervals || intervals.length === 0) return 'Chiuso oggi';

  if (isOpenNow(intervals, now)) {
    const minutes = now.getHours() * 60 + now.getMinutes();
    const active = intervals.find(([o, c]) => minutes >= toMinutes(o) && minutes < toMinutes(c));
    return active ? `Aperto fino alle ${active[1]}` : 'Aperto';
  }

  const minutes = now.getHours() * 60 + now.getMinutes();
  const upcoming = intervals.find(([o]) => toMinutes(o) > minutes);
  if (upcoming) return `Apre alle ${upcoming[0]}`;

  return 'Chiuso ora';
}

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

/**
 * "Adesso" in ora locale italiana (Europe/Rome). Gli orari negozio sono in ora
 * locale IT; il server gira in UTC, quindi per i confronti server-side dobbiamo
 * riportare l'istante all'orologio da parete italiano (così l'enforcement al
 * checkout coincide con ciò che l'utente vede nel filtro "aperti ora").
 */
export function romeNow(base: Date = new Date()): Date {
  return new Date(base.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
}

/**
 * True se il negozio ha orari CONFIGURATI ed è chiuso in questo momento.
 *
 * NULL-safe per non penalizzare i venditori: se `store_hours` è assente, non un
 * oggetto, o non ha alcun giorno con intervalli (orari mai impostati davvero),
 * ritorna false → nessun blocco. Blocca solo quando il venditore ha impostato
 * orari reali ed è chiuso adesso.
 */
export function isStoreClosedForOrder(storeHours: unknown, now: Date = romeNow()): boolean {
  if (!storeHours || typeof storeHours !== 'object') return false;
  const hours = storeHours as StoreHours;
  const configured = DAY_KEYS.some(
    (k) => Array.isArray(hours[k]) && (hours[k] as HoursInterval[]).length > 0,
  );
  if (!configured) return false;
  const todayKey = DAY_KEYS[now.getDay()];
  return !isOpenNow(hours[todayKey], now);
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

import { fasciaAmmessa } from './quando-arriva';

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

/**
 * LA FASCIA SCELTA IN CASSA, LETTA COME GIORNO + FINESTRA.
 *
 * Le etichette le scrive `lib/quando-arriva.ts` e arrivano fin qui come stringa
 * («Domani · 9:00–12:00», «Stasera · 18:00–20:00», «Adesso · arrivo in …»).
 * Qui interessa una cosa sola: parla di domani o di adesso? E, se di domani, fra
 * che ora e che ora?
 */
export type FasciaConsegna = { domani: boolean; daMinuti: number; aMinuti: number } | null;

export function leggiFasciaConsegna(etichetta?: string | null): FasciaConsegna {
  const testo = String(etichetta ?? '').trim();
  if (!testo) return null;
  /**
   * 3/9/2026 — SI LEGGONO SOLO LE FASCE CHE LA CASSA PUÒ DAVVERO PROPORRE.
   *
   * Prima qui bastava che nel testo comparisse la parola «domani». Ma questa
   * stringa arriva dal browser, e chi manda la richiesta a mano ci scrive
   * quello che vuole: con la sola parola «domani», senza orario, il ramo qui
   * sotto apriva una finestra da mezzanotte a mezzanotte e il negozio chiuso
   * risultava servibile. Un permesso non lo può allargare un dato che manda la
   * controparte: l'elenco delle fasce lecite sta in `lib/quando-arriva.ts` e
   * il confronto è esatto.
   */
  if (!fasciaAmmessa(testo)) return null;
  const domani = /domani/i.test(testo);
  if (!domani) return null;
  // Il trattino delle etichette è quello lungo (–), ma si accettano anche il
  // trattino normale e quello medio.
  const orari = testo.match(/(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/);
  // Fascia senza orario: non si sa quando, quindi non si allarga niente. Torna
  // `null` e vale la regola di prima — il negozio dev'essere aperto ADESSO.
  if (!orari) return null;
  const da = Number(orari[1]) * 60 + Number(orari[2]);
  const a = Number(orari[3]) * 60 + Number(orari[4]);
  return { domani: true, daMinuti: da, aMinuti: Math.max(da, a) };
}

/** Il negozio è aperto in almeno un minuto di quella finestra? */
function apertoNellaFinestra(intervals: HoursInterval[] | undefined, da: number, a: number): boolean {
  if (!intervals || intervals.length === 0) return false;
  return intervals.some(([open, close]) => toMinutes(open) < a && toMinutes(close) > da);
}

/**
 * IL NEGOZIO PUÒ SERVIRE QUESTO ORDINE?
 *
 * ── Il difetto che ha prodotto questa funzione ──────────────────────────────
 * La cassa fa scegliere il giorno di consegna e dalle 20:00 parte da sola su
 * «Domani». Le due rotte che creano l'ordine, però, guardavano solo l'orologio
 * (`isStoreClosedForOrder`): martedì alle 21:15 l'ordine per «Domani · 9:00–12:00»
 * veniva rifiutato con «è chiuso in questo momento», dopo che la persona aveva
 * compilato tutto. La sera è l'ora in cui si compra per il giorno dopo.
 *
 * ── La regola ───────────────────────────────────────────────────────────────
 * Il controllo è nato per il caso «il fattorino andrebbe a vuoto»: vale quando
 * la consegna è ADESSO. Se la consegna è per domani, la domanda giusta è un'altra
 * — domani, in quella fascia, il negozio è aperto? Se sì l'ordine passa.
 *
 * NULL-safe come prima: orari mai impostati ⇒ nessun blocco.
 */
export function negozioPuoServire(
  storeHours: unknown,
  fascia?: string | null,
  now: Date = romeNow(),
): boolean {
  if (!storeHours || typeof storeHours !== 'object') return true;
  const hours = storeHours as StoreHours;
  const configured = DAY_KEYS.some(
    (k) => Array.isArray(hours[k]) && (hours[k] as HoursInterval[]).length > 0,
  );
  if (!configured) return true;

  const scelta = leggiFasciaConsegna(fascia);
  // Adesso / oggi / fascia non riconosciuta: resta la regola di prima.
  if (!scelta) return !isStoreClosedForOrder(storeHours, now);

  const domaniKey = DAY_KEYS[(now.getDay() + 1) % 7];
  return apertoNellaFinestra(hours[domaniKey], scelta.daMinuti, scelta.aMinuti);
}

/**
 * Perché l'ordine non parte, detto alla persona.
 *
 * Una casa sola per tutt'e due le rotte: la frase per «adesso» resta parola per
 * parola quella di prima, quella per «domani» è nuova perché prima non poteva
 * esistere.
 */
export function motivoNegozioChiuso(nomeNegozio: string, fascia?: string | null): string {
  const scelta = leggiFasciaConsegna(fascia);
  if (scelta) {
    return `${nomeNegozio} domani è chiuso in quella fascia. Scegli un altro orario, oppure ritira in negozio.`;
  }
  return `${nomeNegozio} è chiuso in questo momento. Riprova durante gli orari di apertura indicati sulla pagina del negozio.`;
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

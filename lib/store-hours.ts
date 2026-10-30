import {
  ETICHETTA_ADESSO,
  MINUTI_PER_IL_RITIRO,
  MINUTI_PRIMA_DELLA_FINE,
  fasciaAmmessa,
  finestraDellaFascia,
} from './quando-arriva';

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

/**
 * APERTO ADESSO? — l'orologio è quello italiano, non quello di chi esegue.
 *
 * Gli orari del negozio sono scritti in ora locale italiana. Chi chiama questa
 * funzione senza passare un istante (i filtri «aperti ora» e le etichette della
 * vetrina) prima leggeva l'orologio della macchina: nel browser di Piacenza
 * andava bene, ma la prima resa la fa il server, che gira in UTC. Alle 13:30
 * italiane il server leggeva 11:30 e diceva «aperto» su un negozio che chiude
 * alle 13:00 — e la cassa, che usa già romeNow, rifiutava l'ordine. Un valore
 * di partenza solo, per tutte e due le domande.
 */
export function isOpenNow(intervals?: HoursInterval[], now: Date = romeNow()): boolean {
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
 * Servono due risposte: di che giorno parla, e fra che ora e che ora.
 *
 * ── 8/9/2026 — PERCHÉ IL GIORNO NON SI LEGGE PIÙ DENTRO L'ETICHETTA ─────────
 * Prima il giorno lo decideva `/domani/i.test(etichetta)`: senza quella parola
 * la fascia non veniva letta e si ricadeva sull'orologio. Ma le fasce di oggi
 * («In giornata · 15:00–18:00», «Stasera · 18:00–20:00») non contengono nessuna
 * parola che quella prova sappia riconoscere: cadevano tutte nel ripiego. Alle
 * 14:00, col fornaio in pausa fino alle 16, l'ordine per le 18 veniva rifiutato
 * con «è chiuso in questo momento» — mentre lo stesso negozio, alla stessa ora,
 * accettava l'ordine per domani mattina. Due risposte opposte alla stessa
 * domanda, sullo stesso negozio chiuso.
 *
 * Un'etichetta è un testo per gli occhi, non un dato. Il giorno adesso si
 * ricava dall'ELENCO che quelle etichette le genera: se la stringa è una delle
 * fasce di oggi è oggi, se è una di quelle di domani è domani, se è l'express è
 * adesso. Chi aggiunge una fascia in `lib/quando-arriva.ts` la trova
 * classificata da sola; chi ne aggiunge una di un TERZO tipo trova un rosso in
 * `tests/unit/il-negozio-che-riapre-alle-16-accetta-l-ordine-per-stasera.test.ts`
 * invece di un ripiego silenzioso.
 */
export type FinestraConsegna =
  | { giorno: 'adesso' }
  | { giorno: 'oggi' | 'domani'; daMinuti: number; aMinuti: number };

export function leggiFinestraConsegna(etichetta?: string | null): FinestraConsegna | null {
  const testo = String(etichetta ?? '').trim();
  if (!testo) return null;
  /**
   * 3/9/2026 — SI LEGGONO SOLO LE FASCE CHE LA CASSA PUÒ DAVVERO PROPORRE.
   *
   * Questa stringa arriva dal browser, e chi manda la richiesta a mano ci
   * scrive quello che vuole: con la sola parola «domani», senza orario, qui
   * sotto si apriva una finestra da mezzanotte a mezzanotte e il negozio chiuso
   * risultava servibile. Un permesso non lo può allargare un dato che manda la
   * controparte: l'elenco delle fasce lecite sta in `lib/quando-arriva.ts` e il
   * confronto è esatto.
   */
  if (!fasciaAmmessa(testo)) return null;
  if (testo === ETICHETTA_ADESSO) return { giorno: 'adesso' };

  // 30/10/2026 (ondata 22) — Giorno e minuti si leggono dalla stessa tabella che scrive le
  // etichette (`finestraDellaFascia`), fasce di prima comprese: niente più orari pescati dal testo.
  // Ammessa, ma di un tipo che qui non si sa collocare: non si indovina niente, e chi chiama
  // ricade sulla regola dell'orologio.
  const finestra = finestraDellaFascia(testo);
  if (!finestra) return null;
  return { giorno: finestra.giorno, daMinuti: finestra.daMinuti, aMinuti: Math.max(finestra.daMinuti, finestra.aMinuti) };
}

/**
 * La stessa lettura, ridotta alla domanda di prima: «è per domani?».
 *
 * @deprecated Chi decide usi `leggiFinestraConsegna`, che risponde anche sulle
 * fasce di oggi. Questa resta perché il contratto vecchio — `null` su tutto ciò
 * che non è domani — è quello su cui contano le prove del 3/9; ma il giorno non
 * lo decide più una parola dentro il testo.
 */
export type FasciaConsegna = { domani: boolean; daMinuti: number; aMinuti: number } | null;

export function leggiFasciaConsegna(etichetta?: string | null): FasciaConsegna {
  const finestra = leggiFinestraConsegna(etichetta);
  if (!finestra || finestra.giorno !== 'domani') return null;
  return { domani: true, daMinuti: finestra.daMinuti, aMinuti: finestra.aMinuti };
}

/** I minuti passati dalla mezzanotte, sull'orologio da parete. */
function minutiDelGiorno(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Il ritiro si può cominciare in un momento fra `da` e `a` (estremi compresi, in minuti dalla
 * mezzanotte)? Cioè: il negozio è aperto in quel momento e resta aperto almeno
 * `MINUTI_PER_IL_RITIRO` minuti. Gli intervalli sono [apre, chiude): alle 19:30 un forno che
 * chiude alle 19:30 è già chiuso.
 *
 * 30/10/2026 (collaudo dell'ondata 22) — prima bastava un momento solo: lunedì alle 12:50 la
 * 13:00–16:30 passava perché il forno era aperto ancora 10 minuti, e alle 12:55 il freno della
 * veloce ci spostava la spesa. Il forno chiude alle 13 e riapre alle 16:30, quando la fascia è
 * finita: nessuno accetta, prepara e consegna la busta in 5 minuti.
 */
function ritiroPossibileFra(intervals: HoursInterval[] | undefined, da: number, a: number): boolean {
  if (!intervals || intervals.length === 0 || a < da) return false;
  return intervals.some(([open, close]) => {
    const inizio = Math.max(da, toMinutes(open));
    return inizio <= a && inizio + MINUTI_PER_IL_RITIRO <= toMinutes(close);
  });
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
 * Il controllo è nato per il caso «il fattorino andrebbe a vuoto». La domanda
 * giusta non è mai «è aperto adesso?», è «in quella finestra è aperto?»:
 *   · fascia di DOMANI  → guarda gli orari di domani in quella finestra;
 *   · fascia di OGGI    → guarda gli orari di oggi, ma solo nella parte di
 *                         finestra che deve ancora venire (era il difetto
 *                         dell'8/9: alle 14:00 la pausa pranzo rifiutava
 *                         l'ordine per le 18, quando il negozio riapre alle 16);
 *   · «adesso» / niente → resta l'orologio, come prima.
 *
 * ── I due paletti che tengono ───────────────────────────────────────────────
 * ① Una fascia di oggi GIÀ FINITA non è un permesso: alle 21:15 «Stasera ·
 *    18:00–20:00» è un appuntamento nel passato, e un bar aperto fino alle 23
 *    lo farebbe passare se si guardasse solo la sovrapposizione.
 * ② Della finestra di oggi conta solo il residuo: alle 17:50, su «In giornata ·
 *    15:00–18:00», un negozio che ha chiuso alle 17 non può servire nessuno.
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

  const scelta = leggiFinestraConsegna(fascia);
  // Consegna immediata, o fascia che non si sa leggere: resta la regola di prima.
  if (!scelta || scelta.giorno === 'adesso') return !isStoreClosedForOrder(storeHours, now);

  // 30/10/2026 (ondata 22) — LA REGOLA DEL RITIRO (scelta di Nicola). La merce si ritira quando
  // il negozio è aperto e MyCity la tiene da parte fino alla fascia: conta che il ritiro si possa
  // cominciare fra adesso e 60 minuti prima della fine della fascia, con il negozio che resta aperto
  // almeno un quarto d'ora (`MINUTI_PER_IL_RITIRO`), anche se durante la fascia è chiuso. Lunedì alle 12:00 Pane Quotidiano (9-13, 16:30-19:30) serve la 13:00–16:30
  // (si ritira entro le 13); alle 14:00 no, riapre alle 16:30 e il ritiro andrebbe oltre le 15:30.
  const adesso = minutiDelGiorno(now);
  const limite = scelta.aMinuti - MINUTI_PRIMA_DELLA_FINE;
  const oggiKey = DAY_KEYS[now.getDay()];

  if (scelta.giorno === 'domani') {
    // Per una fascia di domani il ritiro si fa domani, prima del limite. Scelta prudente (AD,
    // 30/10): la regola alla lettera ammetterebbe anche il ritiro di stasera con la merce tenuta
    // da parte una notte (sabato sera per la domenica chiusa); finché Nicola non decide la notte,
    // la cassa non la promette.
    const domaniKey = DAY_KEYS[(now.getDay() + 1) % 7];
    return ritiroPossibileFra(hours[domaniKey], 0, limite);
  }

  // Paletti ① e ②: una fascia di oggi già finita, o a meno di un'ora dalla fine, non ha più un
  // momento per il ritiro (`ritiroPossibileFra` con `limite < adesso` risponde no).
  return ritiroPossibileFra(hours[oggiKey], adesso, limite);
}

/**
 * Perché l'ordine non parte, detto alla persona.
 *
 * Una casa sola per tutt'e due le rotte, e una frase per ciascuno dei tre no.
 * Quella per «adesso» resta parola per parola quella di prima. Le altre due
 * dicono il motivo vero: prima chi sceglieva «Stasera · 18:00–20:00» si sentiva
 * rispondere «è chiuso in questo momento», che era una risposta a una domanda
 * che non aveva fatto.
 */
export function motivoNegozioChiuso(
  nomeNegozio: string,
  fascia?: string | null,
  now: Date = romeNow(),
): string {
  const scelta = leggiFinestraConsegna(fascia);
  if (scelta?.giorno === 'domani') {
    return `${nomeNegozio} domani è chiuso in quella fascia. Scegli un altro orario, oppure ritira in negozio.`;
  }
  if (scelta?.giorno === 'oggi') {
    if (scelta.aMinuti <= minutiDelGiorno(now)) {
      return 'La fascia che hai scelto è già passata. Scegline una ancora disponibile, oppure ordina per domani.';
    }
    return `${nomeNegozio} oggi è chiuso in quella fascia. Scegli un altro orario, oppure ritira in negozio.`;
  }
  return `${nomeNegozio} è chiuso in questo momento. Riprova durante gli orari di apertura indicati sulla pagina del negozio.`;
}

/** Stessa regola di isOpenNow: l'ora è quella italiana anche qui. */
export function formatToday(intervals?: HoursInterval[], now: Date = romeNow()): string {
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

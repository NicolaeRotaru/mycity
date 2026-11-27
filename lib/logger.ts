import { captureError } from '@/lib/analytics/sentry';
import { testoSenzaEmail } from '@/lib/analytics/filmato-senza-dati-personali';

/**
 * Logger wrapper — strutturato, integrato con Sentry.
 *
 * Esperti consultati:
 * - SRE: "console.error in prod = perso. Routed via Sentry → tracking + alerting."
 * - Security Engineer: "Mai PII raw in log. Sanitize input prima."
 *
 * Uso:
 *   logger.info('Order placed', { orderId, total });
 *   logger.warn('Slow query', { duration });
 *   logger.error(err, { context: 'checkout-submit', userId });
 */

type LogContext = Record<string, unknown> | unknown;

/**
 * 22/8/2026 — IL FILTRO CERCAVA IL NOME ESATTO, E NELLA REALTÀ I NOMI SONO COMPOSTI.
 *
 * Il confronto era ancorato («^…$»), quindi oscurava `phone` ma lasciava
 * passare `delivery_phone`. Nel codice vero i campi si chiamano così:
 * `delivery_phone`, `billing_iban`, `delivery_address`, `delivery_full_name`,
 * `customer_email`. Il filtro difendeva la forma che nessuno usa e lasciava
 * scoperta quella che si usa dappertutto.
 *
 * Il database aveva già la regola giusta — `activity_key_sensibile` nella
 * migrazione 115 confronta per SOMIGLIANZA — ma il registro delle attività e i
 * log dell'applicazione non si parlavano.
 *
 * Adesso si oscura ogni chiave che CONTIENE una di queste parole. Il prezzo è
 * qualche oscuramento in più del necessario (`nome_file` finisce oscurato), e
 * si paga volentieri: un dato personale in chiaro nei log finisce dentro
 * Sentry, che sta fuori dall'Europa, e da lì non lo togli più.
 */
const PII_KEYS =
  /(email|password|passwd|\bpass\b|token|authorization|\bauth\b|cookie|phone|tel|iban|card|cvv|secret|api_?key|ssn|fiscal|codice_?fiscale|\bcf\b|vat|partita_?iva|pec|address|indirizzo|name|nome|cognome|surname|birth|nascita)/i;

/**
 * 24/11/2026 (R03-013) — IL TESTO SI OSCURA COME LE CHIAVI.
 *
 * Il filtro guardava solo i NOMI delle chiavi del contesto: un contesto stringa diventava
 * `{ detail }` senza essere guardato, e il messaggio arrivava com'era. `logger.warn('x',
 * 'mario@x.it')` mandava l'indirizzo in chiaro nei log e a Sentry. Adesso ogni testo passa da qui
 * — il messaggio, un contesto stringa, i valori stringa del contesto, il messaggio e la pila di un
 * Error messo nel contesto — e quello che si riconosce dalla forma diventa `[redacted]`: email,
 * IBAN, codice fiscale, gettoni (JWT) e numeri di telefono (dalla forma, non «9 cifre qualunque»:
 * timestamp, id, date e versioni restano leggibili). Un nome o una via scritti in una frase non si riconoscono dalla forma: per
 * quelli resta la regola delle chiavi.
 */
const DATI_NEL_TESTO: Array<[forma: RegExp, sostituto: string]> = [
  // IBAN (anche a gruppi di quattro), codice fiscale, gettone JWT.
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g, '[redacted]'],
  [/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi, '[redacted]'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]'],
  // Telefono o carta: il carattere prima si cattura e si rimette (niente lookbehind: Safari prima
  // della 16.4 non lo legge, e il logger gira anche nel browser).
  // Solo la FORMA di un telefono italiano: prefisso facoltativo (+39, 0039, +), poi un cellulare (3xx,
  // 9-10 cifre) o un fisso (0x.., 9-11 cifre), con spazi/punti/trattini fra gruppi tipici. Non
  // attaccato a lettere, cifre, `/`, `:`, `_`, `-`: così restano leggibili timestamp, id in URL,
  // date e versioni. Scelta: un numero nudo di 9-11 cifre che inizia con 3 o 0 è ambiguo, e si oscura.
  // R17-010 — I gruppi si scrivono in tanti modi («333 12 34 567», «333 1234 567», «0523 12 34 56»):
  // dopo il prefisso del cellulare (3xx) o del fisso (0…) le cifre restanti possono avere uno spazio,
  // un punto o un trattino fra l'una e l'altra; il numero di cifre resta quello di un telefono. Una
  // data «05.11.2026» (gg.mm.aaaa) non è un fisso, e resta leggibile.
  // R10-008 — Altre forme di tutti i giorni uscivano in chiaro: il prefisso fra parentesi
  // («(0523) 123456»), la barra dopo il prefisso («0523/123456», com'è scritto il fisso di tanti
  // negozi), il link «tel:+39…» (i due punti dopo una lettera) e lo spazio codificato di un
  // indirizzo («%20333…»). La barra vale solo subito dopo il prefisso: una data «05/11/2026» non
  // ha la forma, e un percorso «/ordini/0523123456» resta leggibile come prima.
  [
    /(^|[^\w/:-]|[A-Za-z]:|%20)(?:(?:\+|00)39[ .-]?|\+)?\(?(?:3\d{2}\)?\/?(?:[ .-]?\d){6,7}|(?!0\d[./-]\d{2}[./-]\d{4}(?![\w/:-]))0\d{1,3}\)?\/?(?:[ .-]?\d){6,8})(?![\w/:-])/g,
    '$1[redacted]',
  ],
];

function oscuraTesto(testo: string): string {
  // L'email con la scansione lineare già usata per il filmato dello schermo (niente lookbehind).
  let t = testoSenzaEmail(testo, '[redacted]');
  for (const [forma, sostituto] of DATI_NEL_TESTO) t = t.replace(forma, sostituto);
  return t;
}

/**
 * R15-012 — Oltre il limite di profondità non esce mai il valore com'è: esce questo segnaposto.
 * Prima redact restituiva l'oggetto originale, e chi lo scriveva dopo (la riga di log, l'extra di
 * Sentry) lo scriveva in chiaro: un contesto che tornava su se stesso rimetteva l'email della
 * radice nella riga. Anche una chiave che non si riesce a leggere (un getter che lancia) diventa un
 * segnaposto, invece di far lanciare il logger.
 */
const TROPPO_PROFONDO = '[troppo profondo]';
const NON_LEGGIBILE = '[non leggibile]';

/**
 * R17-011 — UN VALORE SOLO NON SI PORTA VIA TUTTO IL CONTESTO.
 *
 * Un BigInt (JSON.stringify lancia: «Do not know how to serialize a BigInt») o un `toJSON` che lancia
 * facevano cadere la scrittura della riga intera, e il contesto usciva come «[non scrivibile]»: un id
 * a 64 bit nel contesto di un rimborso fallito cancellava anche l'ordine e il motivo. Adesso il BigInt
 * esce come testo e una funzione (anche un `toJSON` di chi chiama) non è un dato: non si copia, così
 * nessuno la chiama scrivendo. Date, Map e Set non hanno chiavi proprie e uscivano come `{}`: la data
 * esce come ISO, la Map come oggetto (con la regola delle chiavi), il Set come elenco.
 */
function eUnaData(valore: object): valore is Date {
  return valore instanceof Date || leggi(() => Object.prototype.toString.call(valore) === '[object Date]', false);
}

function dataScritta(valore: Date): string {
  const ms = leggi(() => Date.prototype.getTime.call(valore), Number.NaN);
  return Number.isNaN(ms) ? 'Invalid Date' : new Date(ms).toISOString();
}

function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return oscuraTesto(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return undefined;
  if (typeof value !== 'object') return value;
  if (eUnaData(value)) return dataScritta(value);
  if (depth > 4) return TROPPO_PROFONDO;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  // #232 — Un Error va trattato per quello che è, PRIMA del ramo «oggetto».
  // Un Error non ha proprietà enumerabili: Object.entries() su di lui torna
  // una lista vuota, quindi finiva nel log come `{}`. In settantuno chiamate
  // su ottantaquattro l'errore era il secondo argomento, quindi nei log
  // restava la frase («rimborso fallito») e spariva il motivo. Chi apriva il
  // log dopo un rimborso fallito leggeva: rimborso fallito, {}.
  if (eUnErrore(value)) {
    const pila = leggi(() => value.stack, undefined);
    return {
      name: leggi(() => value.name, NON_LEGGIBILE),
      message: oscuraTesto(leggi(() => String(value.message ?? ''), NON_LEGGIBILE)),
      stack: typeof pila === 'string' ? oscuraTesto(pila) : pila,
    };
  }
  if (value instanceof Map) {
    const voci = leggi(() => Array.from(value.entries()), null);
    if (!voci) return NON_LEGGIBILE;
    const comeOggetto: Record<string, unknown> = Object.create(null);
    for (const [chiave, v] of voci) comeOggetto[leggi(() => String(chiave), NON_LEGGIBILE)] = v;
    return redact(comeOggetto, depth);
  }
  if (value instanceof Set) {
    const elementi = leggi(() => Array.from(value.values()), null);
    return elementi ? elementi.map((v) => redact(v, depth + 1)) : NON_LEGGIBILE;
  }
  if (typeof value === 'object') {
    // R17-011 — senza prototipo (una chiave «__proto__» resta una chiave) e con la lettura delle
    // chiavi protetta: un valore che non si legge diventa solo lui «[non leggibile]».
    const out: Record<string, unknown> = Object.create(null);
    const chiavi = leggi(() => Object.keys(value), null);
    if (!chiavi) return NON_LEGGIBILE;
    for (const k of chiavi) {
      if (PII_KEYS.test(k)) {
        out[k] = '[redacted]';
        continue;
      }
      let v: unknown;
      try {
        v = (value as Record<string, unknown>)[k];
      } catch {
        out[k] = NON_LEGGIBILE;
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * R15-011 — L'ERRORE VERO VA A SENTRY OSCURATO, NON INTERO.
 *
 * La frase e il contesto passavano già da `oscuraTesto`, ma un oggetto Error andava a Sentry così
 * com'era (`captureException(err)`): un errore del database con l'email del cliente nel messaggio
 * («Key (email)=(mario@…) already exists») usciva in chiaro, e il filtro di Sentry non tocca il
 * testo delle eccezioni. Qui si fa una COPIA (l'Error di chi chiama non si tocca): stesso
 * prototipo, stesso nome, messaggio oscurato, e della pila si oscura solo la testa (nome e
 * messaggio) — le righe «at …» restano com'erano, perché a Sentry servono percorsi e numeri di
 * riga. Le altre proprietà restano, coi testi oscurati; la causa (e gli `errors` di un
 * AggregateError) si oscurano allo stesso modo, perché Sentry manda anche quelle.
 */
/**
 * 26/11/2026 (secondo giro) — Mai il valore originale, nessuna lettura che fa lanciare.
 * ① Ogni Error già copiato si ritrova (una causa che torna su se stessa, un AggregateError che
 *   contiene se stesso: la copia punta alla copia). Oltre `PROFONDITA_DELLE_CAUSE` livelli resta un
 *   segnaposto, mai l'originale; il budget copre più di quello che Sentry legge (al massimo sei
 *   eccezioni collegate), e una lista non consuma un livello in più dei suoi elementi.
 * ② Le letture (messaggio, nome, pila, proprietà) sono protette: un getter che lancia, o un `name`
 *   del prototipo che legge un campo privato, lasciano un Error semplice col nome di prima.
 * ③ Un Error di un altro contesto JavaScript (modulo vm) si riconosce anche senza instanceof, e la
 *   copia diventa un Error di questo contesto.
 */
const PROFONDITA_DELLE_CAUSE = 10;
const ERRORE_TROPPO_PROFONDO = '[errore troppo profondo]';

function leggi<T>(lettura: () => T, ripiego: T): T {
  try {
    return lettura();
  } catch {
    return ripiego;
  }
}

function eUnErrore(valore: unknown): valore is Error {
  if (valore instanceof Error) return true;
  if (valore === null || typeof valore !== 'object') return false;
  return leggi(() => {
    const isError = (Error as unknown as { isError?: (v: unknown) => boolean }).isError;
    return typeof isError === 'function' ? isError(valore) : Object.prototype.toString.call(valore) === '[object Error]';
  }, false);
}

function pilaOscurata(pila: string): string {
  const righe = pila.search(/\n\s+at /);
  return righe < 0 ? oscuraTesto(pila) : oscuraTesto(pila.slice(0, righe)) + pila.slice(righe);
}

function valoreOscurato(valore: unknown, profondita: number, copie: WeakMap<object, unknown>): unknown {
  if (typeof valore === 'string') return oscuraTesto(valore);
  if (valore === null || typeof valore !== 'object') return valore;
  if (copie.has(valore)) return copie.get(valore);
  if (profondita > PROFONDITA_DELLE_CAUSE) return eUnErrore(valore) ? new Error(ERRORE_TROPPO_PROFONDO) : ERRORE_TROPPO_PROFONDO;
  if (eUnErrore(valore)) return erroreOscurato(valore, profondita, copie);
  if (Array.isArray(valore)) {
    const lista: unknown[] = [];
    copie.set(valore, lista);
    // Gli elementi stanno allo stesso livello della lista: la lista non consuma un livello.
    for (const v of valore) lista.push(valoreOscurato(v, profondita, copie));
    return lista;
  }
  return redact(valore);
}

function erroreOscurato(err: Error, profondita = 0, copie = new WeakMap<object, unknown>()): Error {
  const copia = new Error(oscuraTesto(leggi(() => String(err.message ?? ''), '')));
  copie.set(err, copia);
  const nome = oscuraTesto(leggi(() => String(err.name ?? 'Error'), 'Error'));
  // Il prototipo resta solo se è di questo contesto e si legge anche sulla copia. Un DOMException
  // (l'AbortError di fetch), un errore di un altro contesto o un `name` che legge un campo privato
  // farebbero lanciare chi la legge (Sentry compreso): lì la copia resta un Error semplice.
  const host = typeof DOMException !== 'undefined' && err instanceof DOMException;
  const proto = leggi(() => Object.getPrototypeOf(err) as object | null, null);
  if (!host && err instanceof Error && proto && proto !== Error.prototype) {
    Object.setPrototypeOf(copia, proto);
    const siLegge = leggi(() => typeof copia.name === 'string' && typeof copia.message === 'string' && typeof String(copia) === 'string', false);
    if (!siLegge) Object.setPrototypeOf(copia, Error.prototype);
  }
  if (leggi(() => copia.name, undefined) !== nome) {
    Object.defineProperty(copia, 'name', { value: nome, writable: true, configurable: true, enumerable: false });
  }
  for (const chiave of leggi(() => Object.getOwnPropertyNames(err), [] as string[])) {
    if (chiave === 'message' || chiave === 'stack') continue;
    const d = leggi(() => Object.getOwnPropertyDescriptor(err, chiave), undefined);
    if (!d || !('value' in d)) continue;
    const valore = valoreOscurato(d.value, profondita + 1, copie);
    leggi(() => Object.defineProperty(copia, chiave, { ...d, value: valore }), copia);
  }
  const pila = leggi(() => err.stack, undefined);
  Object.defineProperty(copia, 'stack', {
    value: typeof pila === 'string' ? pilaOscurata(pila) : undefined,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return copia;
}

function toCtx(ctx: unknown): Record<string, unknown> | undefined {
  if (ctx === undefined || ctx === null) return undefined;
  let obj: Record<string, unknown>;
  if (typeof ctx === 'string') obj = { detail: ctx };
  else if (typeof ctx === 'object') obj = ctx as Record<string, unknown>;
  else obj = { value: ctx };
  return redact(obj) as Record<string, unknown>;
}

/** R15-012 — Il contesto oscurato, senza mai lanciare: se non si riesce a leggerlo resta un segnaposto. */
function ctxSicuro(ctx: unknown): Record<string, unknown> | undefined {
  try {
    return toCtx(ctx);
  } catch {
    return { contesto: NON_LEGGIBILE };
  }
}

/**
 * Cattura server-side affidabile per gli errori di API/cron/webhook.
 *
 * Usa il SDK @sentry/nextjs già inizializzato da sentry.server.config.ts (via
 * instrumentation), con rilevamento DSN COERENTE col server (NEXT_PUBLIC_SENTRY_DSN
 * *o* SENTRY_DSN). Non passa dal wrapper `'use client'` (lib/analytics/sentry):
 * così un errore notturno del cron release-payouts o del webhook Stripe non viene
 * perso silenziosamente solo perché in prod è configurato SENTRY_DSN e non quello
 * pubblico. (Invariante: "si misura" — i fallimenti di soldi/consegna sono visibili.)
 */
async function captureServerError(err: unknown, ctx?: Record<string, unknown>): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
  if (!dsn) return;
  const Sentry = await import('@sentry/nextjs').catch(() => null);
  Sentry?.captureException(err, ctx ? { extra: ctx } : undefined);
}

/**
 * 17/11/2026 — GLI AVVISI SCRITTI NEL BROWSER NON LI LEGGEVA NESSUNO.
 *
 * Nel browser `warn` era solo `console.warn`: finiva nella console di chi
 * guardava la pagina, e i commenti che li dicevano «nei log» mentivano. Adesso,
 * lato client, l'avviso va anche al registratore degli errori che `error` usa
 * già (Sentry), con il livello «warning». Senza DSN non si scarica niente, come
 * per gli errori.
 */
async function captureClientWarning(msg: string, ctx?: Record<string, unknown>): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs').catch(() => null);
  Sentry?.captureMessage(msg, { level: 'warning', ...(ctx ? { extra: ctx } : {}) });
}

/**
 * 21/11/2026 (R01-005) — GLI ERRORI DEL SITO SI CONTANO ANCHE CON IL REGISTRATORE SPENTO.
 *
 * Il registratore degli errori (Sentry) resta spento per scelta, e senza la sua chiave
 * `logger.error` scriveva solo nei log di Vercel: il giorno del lancio un errore del sito non lo
 * vedeva nessuno, e l'unico allarme possibile dipendeva proprio dalla chiave che manca. Qui ogni
 * errore del server si conta, ora per ora, nello stesso Upstash che usa il freno anti-abuso
 * (nessuna chiave nuova): solo il numero, nessun testo, quindi nessun dato personale esce dai log.
 * Il sorvegliante (operational-alerts) legge il conto (stessa chiave: `chiaveErroriDellOra`) e, se
 * c'è, avvisa in campanella e per email.
 *
 * Un conteggio perso (Upstash giù, funzione chiusa prima della risposta) non ferma niente: è un
 * campanello in più, non un registro.
 */
const ERRORI_DURATA_SECONDI = 2 * 24 * 60 * 60;

function upstashDegliErrori(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

/** Una chiave per ora (UTC) e per ambiente: gli errori delle anteprime non suonano per il sito vero. */
function chiaveErroriDellOra(ms: number): string {
  const ambiente = process.env.VERCEL_ENV || process.env.NODE_ENV || 'sconosciuto';
  return `mc:errori-del-sito:${ambiente}:${new Date(ms).toISOString().slice(0, 13)}`;
}

/**
 * 21/11/2026 — IL CONTO DEGLI ERRORI HA UN TEMPO MASSIMO E NON FA UNA RICHIESTA PER ERRORE.
 *
 * Prima ogni `logger.error` del server faceva la sua chiamata a Upstash, senza tempo massimo: in una
 * tempesta di errori partiva una richiesta per errore, senza limite, e una chiamata che non
 * rispondeva restava appesa quanto voleva. Adesso:
 * - la chiamata si interrompe dopo `ERRORI_TEMPO_MASSIMO_MS`;
 * - gli errori dello stesso giro si sommano in memoria e partono in UNA richiesta sola (una pipeline);
 * - le richieste hanno un tetto: una piccola scorta (`ERRORI_SCORTA`) che si ricarica di una ogni
 *   `ERRORI_FINESTRA_MS`. Finché c'è scorta il primo errore parte subito (l'allarme del sorvegliante
 *   scatta già con uno); a scorta finita gli errori si sommano e partono tutti insieme, in una
 *   richiesta, appena se ne ricarica una. Così in una tempesta le richieste restano poche e contate.
 * Il numero si manda con comandi INCR ripetuti nella stessa pipeline (INCRBY solo per pacchetti grandi).
 * Se la funzione si chiude prima di mandare il resto, si perde il numero esatto, non l'allarme.
 */
const ERRORI_FINESTRA_MS = 10_000;
const ERRORI_TEMPO_MASSIMO_MS = 3_000;
const ERRORI_SCORTA = 5;
const ERRORI_INCR_RIPETUTI_MAX = 20;
const erroriDaMandare = new Map<string, number>();
let erroriScorta = ERRORI_SCORTA;
let erroriUltimaRicarica = 0;
let erroriMandoPronto = false;
let erroriAttesa: ReturnType<typeof setTimeout> | null = null;

function chiamaUpstash(u: { url: string; token: string }, comandi: unknown[][]): Promise<void> {
  const freno = new AbortController();
  const tempo = setTimeout(() => freno.abort(), ERRORI_TEMPO_MASSIMO_MS);
  try {
    return fetch(`${u.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(comandi),
      cache: 'no-store',
      signal: freno.signal,
    }).then(() => clearTimeout(tempo), () => clearTimeout(tempo));
  } catch {
    clearTimeout(tempo);
    return Promise.resolve();
  }
}

/** Manda in una richiesta sola tutti gli errori sommati finora. Non lancia mai. */
function mandaErroriSommati(): void {
  const u = upstashDegliErrori();
  if (!u || erroriDaMandare.size === 0) {
    erroriDaMandare.clear();
    return;
  }
  const comandi: unknown[][] = [];
  for (const [chiave, quanti] of erroriDaMandare) {
    if (quanti <= ERRORI_INCR_RIPETUTI_MAX) for (let i = 0; i < quanti; i++) comandi.push(['INCR', chiave]);
    else comandi.push(['INCRBY', chiave, quanti]);
    comandi.push(['EXPIRE', chiave, ERRORI_DURATA_SECONDI]);
  }
  erroriDaMandare.clear();
  void chiamaUpstash(u, comandi);
}

/** Ricarica la scorta di una richiesta ogni finestra trascorsa (e non si fa ingannare da un orologio che torna indietro). */
function ricaricaScorta(adesso: number): void {
  const passato = adesso - erroriUltimaRicarica;
  if (passato < 0) {
    erroriUltimaRicarica = adesso;
    return;
  }
  const nuove = Math.floor(passato / ERRORI_FINESTRA_MS);
  if (nuove > 0) {
    erroriScorta = Math.min(ERRORI_SCORTA, erroriScorta + nuove);
    erroriUltimaRicarica += nuove * ERRORI_FINESTRA_MS;
  }
}

/** Scorta finita: gli errori aspettano la prossima ricarica e poi partono insieme. */
function aspettaLaRicarica(adesso: number): void {
  if (erroriAttesa) return;
  const attesa = Math.max(1, ERRORI_FINESTRA_MS - (adesso - erroriUltimaRicarica));
  erroriAttesa = setTimeout(() => {
    erroriAttesa = null;
    if (erroriDaMandare.size === 0) return;
    const ora = Date.now();
    ricaricaScorta(ora);
    if (erroriScorta < 1) return aspettaLaRicarica(ora);
    erroriScorta--;
    mandaErroriSommati();
  }, attesa);
  (erroriAttesa as { unref?: () => void }).unref?.();
}

/** Conta un errore del server. Nel browser e senza Upstash non fa niente; non lancia mai. */
function contaErroreDelSito(adesso: number = Date.now()): void {
  if (typeof window !== 'undefined') return;
  if (!upstashDegliErrori()) return;
  try {
    const chiave = chiaveErroriDellOra(adesso);
    erroriDaMandare.set(chiave, (erroriDaMandare.get(chiave) ?? 0) + 1);
    if (erroriMandoPronto) return;
    ricaricaScorta(adesso);
    if (erroriScorta < 1) return aspettaLaRicarica(adesso);
    erroriScorta--;
    erroriMandoPronto = true;
    queueMicrotask(() => {
      erroriMandoPronto = false;
      mandaErroriSommati();
    });
  } catch {
    // Un conteggio perso non ferma il logger.
  }
}

// Emette una riga di log strutturata (JSON) con contesto redatto (🟡-10).
function line(level: string, msg: string, ctx?: LogContext): string {
  const testo = oscuraTesto(String(msg));
  const ts = new Date().toISOString();
  return scriviRiga({ level, msg: testo, ts, ...(ctxSicuro(ctx) ?? {}) }, level, testo, ts);
}

/**
 * R15-012 — La riga di log non lancia mai. Un contesto che contiene se stesso (o un valore che
 * JSON.stringify non sa scrivere, come un BigInt) faceva salire un TypeError a chi chiamava, e la
 * riga si perdeva. Il contesto arriva qui già oscurato e finito (redact non restituisce mai
 * l'originale: oltre il limite c'è `[troppo profondo]`, e una chiave illeggibile è `[non leggibile]`,
 * `ctxSicuro`); se un riferimento si ripete resta `[circolare]`, e se JSON.stringify lancia comunque
 * resta una riga minima con livello, messaggio e ora.
 */
function scriviRiga(riga: Record<string, unknown>, level: string, msg: string, ts: string): string {
  try {
    const visti = new WeakSet<object>();
    return JSON.stringify(riga, (_chiave, valore: unknown) => {
      if (typeof valore === 'object' && valore !== null) {
        if (visti.has(valore)) return '[circolare]';
        visti.add(valore);
      }
      return valore;
    });
  } catch {
    try {
      return JSON.stringify({ level, msg, ts, contesto: '[non scrivibile]' });
    } catch {
      return `{"level":"${level}","contesto":"[non scrivibile]"}`;
    }
  }
}

/**
 * Sul SERVER si scrive sempre, anche in produzione.
 *
 * Prima le tre funzioni erano avvolte da `NODE_ENV !== 'production'`: in
 * produzione, sul server, non usciva NIENTE nei log. L'unico canale rimasto era
 * la cattura degli errori verso il servizio esterno, che serve a un altro scopo
 * e non aiuta chi apre i log per capire cos'e' successo un minuto prima. Cioe':
 * un guasto in produzione si guardava alla cieca. Il rumore si controlla col
 * livello (`info` resta fuori dalla produzione), non spegnendo tutto.
 */
const eServer = typeof window === 'undefined';

export const logger = {
  info: (msg: string, ctx?: LogContext) => {
    if (process.env.NODE_ENV !== 'production' || process.env.LOG_LEVEL === 'info') {
      console.log(line('info', msg, ctx));
    }
  },

  /**
   * #195 — La spesa. Non e' un messaggio di servizio: e' un numero che deve
   * restare. Prima usciva con `logger.info`, che in produzione e' spento se
   * LOG_LEVEL non vale 'info' — e infatti non e' impostato in produzione.
   * Risultato: quanto costa l'AI in produzione non si vedeva da nessuna parte.
   * Questa esce sempre, come gli avvisi, e resta riconoscibile per grep.
   */
  spesa: (msg: string, ctx?: LogContext) => {
    console.log(line('spesa', msg, ctx));
  },

  warn: (msg: string, ctx?: LogContext) => {
    // Sempre: un avviso in produzione e' esattamente quello che si va a cercare.
    console.warn(line('warn', msg, ctx));
    if (!eServer) void captureClientWarning(oscuraTesto(String(msg)), ctxSicuro(ctx));
  },

  error: (err: unknown, ctx?: LogContext) => {
    // #232 — Gli argomenti invertiti. La firma è `error(errore, contesto)`, ma
    // in settantuno chiamate su ottantaquattro è scritta al contrario:
    // `logger.error('rimborso fallito', err)`. Chi la scrive così non sbaglia
    // per distrazione: è come si scrive in mezzo mondo. Invece di correggere
    // ottantaquattro punti e sperare che nessuno ne aggiunga un altro, li
    // rimette in ordine il logger: l'Error va a Sentry, la frase resta come
    // contesto. Così l'errore vero smette di sparire.
    let errore = err;
    let contesto = ctx;
    if (typeof err === 'string' && eUnErrore(ctx)) {
      errore = ctx;
      contesto = { messaggio: err };
    }
    // R03-013 — Una frase passata come errore va a Sentry così com'è: si oscura prima.
    // R15-011 — Anche un Error (una copia oscurata, pure se viene da un altro contesto) e l'errore del
    // database che arriva come oggetto semplice. Se non si riesce a leggerlo resta un segnaposto.
    try {
      if (typeof errore === 'string') errore = oscuraTesto(errore);
      else if (eUnErrore(errore)) errore = erroreOscurato(errore);
      else if (errore !== null && typeof errore === 'object') errore = redact(errore);
    } catch {
      errore = new Error('[errore non leggibile]');
    }
    if (eServer || process.env.NODE_ENV !== 'production') {
      const messaggio = (errore as { message?: unknown } | null)?.message;
      const testo = typeof messaggio === 'string' ? messaggio : leggi(() => String(errore), '[errore non leggibile]');
      console.error(line('error', testo, contesto));
    }
    const c = ctxSicuro(contesto);
    if (typeof window === 'undefined') {
      // Server (API/cron/webhook): cattura diretta sul SDK server già init'd.
      void captureServerError(errore, c);
      // R01-005 — E si conta, anche col registratore spento: il sorvegliante lo dice (vedi contaErroreDelSito).
      void contaErroreDelSito();
    } else {
      // Client: wrapper lazy esistente (init Sentry browser al primo errore).
      void captureError(errore, c);
    }
  },
};

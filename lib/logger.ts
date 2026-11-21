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
 * 21/11/2026 — OSCURA ANCHE IL TESTO, NON SOLO LE CHIAVI.
 *
 * Il messaggio e ogni valore stringa del contesto, a qualunque profondita',
 * passano per le stesse regole: email, JWT, IBAN e chiavi sensibili fra apici
 * dentro un testo. Ogni testo si guarda fino a TAGLIO_PER_TESTO caratteri, e in
 * una chiamata al massimo TETTO_PER_CHIAMATA in tutto: il resto si tronca con un
 * segno, non passa in chiaro. Niente lookbehind: il logger gira anche nel browser.
 */
const OSCURATO = '[redacted]';
const TRONCATO = '[troncato]';
const TAGLIO_PER_TESTO = 8_000;
const TETTO_PER_CHIAMATA = 100_000;

type Conto = { resto: number };
const nuovoConto = (): Conto => ({ resto: TETTO_PER_CHIAMATA });

/** Un pezzo che il taglio non deve lasciare a meta' (un'email, un JWT). */
const UN_CARATTERE_DI_UN_PEZZO = /[\w.+@-]/;
/** Un JWT: tre pezzi base64url, il primo comincia con `eyJ`. */
const UN_JWT = /(^|[^\w-])eyJ[\w-]{5,}\.[\w-]*(?:\.[\w-]*)?/g;
/** `"password":"x"`, `'token': 'x'`, `"cvv": 123`: la chiave si confronta con PII_KEYS. */
const UNA_CHIAVE_FRA_APICI =
  /(["'])([\w$.-]{1,64})\1(\s{0,10}:\s{0,10})(?:(["'])(?:(?!\4)[^\\\n]|\\.)*(?:\4|$)|[^\s,;{}[\]"']{1,200})/g;
/** Un IBAN, anche minuscolo o a gruppi di quattro: lo conferma il codice di controllo. */
const UN_IBAN = /(^|[^A-Za-z0-9])([A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]){11,30})(?![A-Za-z0-9])/g;

function ibanValido(testo: string): boolean {
  const c = testo.replace(/ /g, '').toUpperCase();
  if (c.length < 15 || c.length > 34) return false;
  let resto = 0;
  for (const ch of c.slice(4) + c.slice(0, 4)) {
    const v = parseInt(ch, 36);
    resto = (v < 10 ? resto * 10 + v : resto * 100 + v) % 97;
  }
  return resto === 1;
}

/** Nasconde l'IBAN valido piu' lungo in testa al pezzo, finito a fine parola. */
function senzaIban(pezzo: string): string {
  for (let fine = pezzo.length; fine >= 15; fine = pezzo.lastIndexOf(' ', fine - 1)) {
    if (ibanValido(pezzo.slice(0, fine))) return OSCURATO + pezzo.slice(fine);
  }
  return pezzo;
}

/** Un testo da qualunque cosa, senza lanciare: un message può essere un numero o un oggetto. */
function comeTesto(x: unknown): string {
  if (typeof x === 'string') return x;
  try {
    return String(x);
  } catch {
    return '[non leggibile]';
  }
}

/** Un errore anche se viene da un altro realm (vm, iframe), dove `instanceof Error` è falso. */
function eUnErrore(x: unknown): x is Error {
  if (x instanceof Error) return true;
  if (x === null || typeof x !== 'object') return false;
  if (Object.prototype.toString.call(x) === '[object Error]') return true;
  const e = x as { message?: unknown; stack?: unknown };
  return typeof e.message === 'string' && typeof e.stack === 'string';
}

function testoPulito(valore: unknown, conto: Conto): string {
  const testo = comeTesto(valore);
  if (!testo) return testo;
  if (conto.resto <= 0) return TRONCATO;
  const massimo = Math.min(TAGLIO_PER_TESTO, conto.resto);
  let t = testo;
  let coda = '';
  if (testo.length > massimo) {
    let fine = massimo;
    if (UN_CARATTERE_DI_UN_PEZZO.test(testo[fine])) {
      while (fine > 0 && UN_CARATTERE_DI_UN_PEZZO.test(testo[fine - 1])) fine--;
    }
    t = testo.slice(0, fine);
    coda = `…${TRONCATO}`;
  }
  conto.resto -= Math.min(testo.length, massimo);
  t = t
    .replace(UNA_CHIAVE_FRA_APICI, (intero: string, apice: string, chiave: string, inMezzo: string, apiceDelValore?: string) =>
      PII_KEYS.test(chiave)
        ? `${apice}${chiave}${apice}${inMezzo}${apiceDelValore ? `${apiceDelValore}${OSCURATO}${apiceDelValore}` : OSCURATO}`
        : intero)
    .replace(UN_JWT, (_: string, prima: string) => `${prima}${OSCURATO}`);
  t = testoSenzaEmail(t, OSCURATO).replace(UN_IBAN, (_: string, prima: string, pezzo: string) => `${prima}${senzaIban(pezzo)}`);
  return t + coda;
}

function redact(value: unknown, depth: number, conto: Conto): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return testoPulito(value, conto);
  // Oltre la profondita' un oggetto non passa intero: si tronca con un segno.
  if (depth > 4) return typeof value === 'object' ? TRONCATO : value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, conto));
  // #232 — Un Error va trattato per quello che è, PRIMA del ramo «oggetto».
  // Un Error non ha proprietà enumerabili: Object.entries() su di lui torna
  // una lista vuota, quindi finiva nel log come `{}`. In settantuno chiamate
  // su ottantaquattro l'errore era il secondo argomento, quindi nei log
  // restava la frase («rimborso fallito») e spariva il motivo. Chi apriva il
  // log dopo un rimborso fallito leggeva: rimborso fallito, {}.
  if (eUnErrore(value)) {
    return {
      name: value.name,
      message: testoPulito(value.message, conto),
      stack: typeof value.stack === 'string' ? testoPulito(value.stack, conto) : value.stack,
    };
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1, conto);
    }
    return out;
  }
  return value;
}

function toCtx(ctx: unknown, conto: Conto): Record<string, unknown> | undefined {
  if (ctx === undefined || ctx === null) return undefined;
  let obj: Record<string, unknown>;
  if (typeof ctx === 'string') obj = { detail: ctx };
  else if (typeof ctx === 'object') obj = ctx as Record<string, unknown>;
  else obj = { value: ctx };
  return redact(obj, 0, conto) as Record<string, unknown>;
}

/**
 * L'errore che va a Sentry: messaggio, pila e causa passano per le stesse regole.
 * Se non c'e' niente da oscurare parte l'errore com'e'.
 */
function erroreSenzaDati(err: unknown, conto: Conto, giro = 0): unknown {
  if (typeof err === 'string') return testoPulito(err, conto);
  if (!eUnErrore(err)) return err !== null && typeof err === 'object' ? redact(err, 0, conto) : err;
  const messaggio = testoPulito(err.message, conto);
  const pila = typeof err.stack === 'string' ? testoPulito(err.stack, conto) : err.stack;
  const haCausa = 'cause' in err;
  const causa = haCausa ? (giro < 3 ? erroreSenzaDati(err.cause, conto, giro + 1) : TRONCATO) : undefined;
  if (messaggio === err.message && pila === err.stack && causa === err.cause) return err;
  const copia = new Error(messaggio);
  try {
    Object.setPrototypeOf(copia, Object.getPrototypeOf(err));
    const proprio = (valore: unknown) => ({ value: valore, writable: true, configurable: true });
    Object.defineProperty(copia, 'name', proprio(err.name));
    Object.defineProperty(copia, 'stack', proprio(pila));
    if (haCausa) Object.defineProperty(copia, 'cause', proprio(causa));
  } catch {
    // Un errore dalla forma strana parte col solo messaggio oscurato: il logger non lancia.
  }
  return copia;
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

function chiamaUpstash(u: { url: string; token: string }, comandi: unknown[][]): Promise<Response> {
  return fetch(`${u.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(comandi),
    cache: 'no-store',
  });
}

/** Conta un errore del server. Nel browser e senza Upstash non fa niente; non lancia mai. */
function contaErroreDelSito(adesso: number = Date.now()): Promise<void> {
  if (typeof window !== 'undefined') return Promise.resolve();
  const u = upstashDegliErrori();
  if (!u) return Promise.resolve();
  const chiave = chiaveErroriDellOra(adesso);
  try {
    return chiamaUpstash(u, [['INCR', chiave], ['EXPIRE', chiave, ERRORI_DURATA_SECONDI]]).then(() => undefined, () => undefined);
  } catch {
    return Promise.resolve();
  }
}

// Emette una riga di log strutturata (JSON) con messaggio e contesto redatti (🟡-10).
function line(level: string, msg: string, ctx?: LogContext): string {
  const conto = nuovoConto();
  return lineaPulita(level, messaggioPulito(msg, conto), toCtx(ctx, conto));
}

function lineaPulita(level: string, msg: string, ctx?: Record<string, unknown>): string {
  return JSON.stringify({ level, msg, ts: new Date().toISOString(), ...(ctx ?? {}) });
}

function messaggioPulito(msg: string, conto: Conto): string {
  return typeof msg === 'string' ? testoPulito(msg, conto) : msg;
}

/**
 * La rete: il registro non lancia mai. Se pulire la voce lancia (un getter che scoppia, un valore
 * che non si scrive), esce una riga fissa, senza niente della voce: mai il testo grezzo.
 */
const VOCE_NON_LEGGIBILE = '[registro: voce non leggibile]';
function senzaLanciare(level: string, scrivi: (riga: string) => void, fai: () => void): void {
  try {
    fai();
  } catch {
    try {
      scrivi(lineaPulita(level, VOCE_NON_LEGGIBILE));
    } catch { /* nemmeno la console: niente */ }
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
      senzaLanciare('info', (r) => console.log(r), () => console.log(line('info', msg, ctx)));
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
    senzaLanciare('spesa', (r) => console.log(r), () => console.log(line('spesa', msg, ctx)));
  },

  warn: (msg: string, ctx?: LogContext) => {
    // Sempre: un avviso in produzione e' esattamente quello che si va a cercare.
    senzaLanciare('warn', (r) => console.warn(r), () => {
      const conto = nuovoConto();
      const m = messaggioPulito(msg, conto);
      const c = toCtx(ctx, conto);
      console.warn(lineaPulita('warn', m, c));
      if (!eServer) void captureClientWarning(m, c).catch(() => undefined);
    });
  },

  error: (err: unknown, ctx?: LogContext) => {
    // #232 — Gli argomenti invertiti. La firma è `error(errore, contesto)`, ma
    // in settantuno chiamate su ottantaquattro è scritta al contrario:
    // `logger.error('rimborso fallito', err)`. Chi la scrive così non sbaglia
    // per distrazione: è come si scrive in mezzo mondo. Invece di correggere
    // ottantaquattro punti e sperare che nessuno ne aggiunga un altro, li
    // rimette in ordine il logger: l'Error va a Sentry, la frase resta come
    // contesto. Così l'errore vero smette di sparire.
    let pulito: unknown;
    let c: Record<string, unknown> | undefined;
    try {
      let errore = err;
      let contesto = ctx;
      if (typeof err === 'string' && eUnErrore(ctx)) {
        errore = ctx;
        contesto = { messaggio: err };
      }
      const conto = nuovoConto();
      pulito = erroreSenzaDati(errore, conto);
      c = toCtx(contesto, conto);
      if (eServer || process.env.NODE_ENV !== 'production') {
        console.error(lineaPulita('error', eUnErrore(pulito) ? comeTesto(pulito.message) : comeTesto(pulito), c));
      }
    } catch {
      // La rete: l'errore non si perde, ma parte solo la riga fissa, mai il testo grezzo.
      pulito = new Error(VOCE_NON_LEGGIBILE);
      c = undefined;
      try {
        if (eServer || process.env.NODE_ENV !== 'production') console.error(lineaPulita('error', VOCE_NON_LEGGIBILE));
      } catch { /* nemmeno la console: niente */ }
    }
    if (typeof window === 'undefined') {
      // Server (API/cron/webhook): cattura diretta sul SDK server già init'd.
      void captureServerError(pulito, c);
      // R01-005 — E si conta, anche col registratore spento: il sorvegliante lo dice (vedi contaErroreDelSito).
      void contaErroreDelSito();
    } else {
      // Client: wrapper lazy esistente (init Sentry browser al primo errore).
      void captureError(pulito, c);
    }
  },
};

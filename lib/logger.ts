import { captureError } from '@/lib/analytics/sentry';
import { testoSenzaRecapiti } from '@/lib/analytics/filmato-senza-dati-personali';

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
 * 20/11/2026 (R03-021) — IL FILTRO GUARDAVA SOLO I NOMI DELLE CHIAVI.
 *
 * `{ customer_email: … }` usciva oscurato, ma la stessa email scritta nel testo del messaggio
 * («invio fallito a maria@example.it»), in un contesto passato come stringa (finiva in chiaro sotto
 * `detail`) o nel valore di una chiave innocua (`{ errore: '… Bearer eyJ…' }`) passava intera, sulla
 * console e su Sentry. Adesso ogni testo si ripulisce per CONTENUTO, con le famiglie della lista
 * qui sopra che si riconoscono dalla forma: email e telefoni con la regola che il sito usa già per
 * il filmato e gli eventi (`testoSenzaRecapiti`), più gettoni e chiavi, IBAN, carte e codice
 * fiscale. Nomi e indirizzi in un testo libero non hanno una forma: restano affidati alle chiavi.
 */
const NEL_TESTO: ReadonlyArray<readonly [RegExp, string | ((trovato: string) => string)]> = [
  // Gettoni e chiavi: «Bearer …», i JWT (anche la chiave di servizio di Supabase), le chiavi
  // segrete di Stripe, dei webhook, di Supabase e di Anthropic.
  [/\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [redacted]'],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]+)?/g, '[redacted]'],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, '[redacted]'],
  [/\b(?:whsec|sb_secret)_[A-Za-z0-9_-]{8,}/g, '[redacted]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted]'],
  // «password=…», «token: …», «"api_key":"…»: il nome resta, il valore no.
  [/\b(password|passwd|access_token|refresh_token|token|secret|api_?key|apikey|authorization)("?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"',;&]+)/gi, '$1$2[redacted]'],
  // IBAN (anche a gruppi di quattro) e codice fiscale.
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g, '[redacted]'],
  [/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi, '[redacted]'],
  // Carte: da 13 a 19 cifre, anche a gruppi, che passano il controllo di Luhn. I confini non
  // toccano gli identificativi (uuid, codici con lettere o trattini attaccati).
  [/(?<![\w-])\d(?:[ -]?\d){12,18}(?![\w-])/g, (trovato) => (passaLuhn(trovato.replace(/\D/g, '')) ? '[redacted]' : trovato)],
];

function passaLuhn(cifre: string): boolean {
  let somma = 0;
  for (let i = 0; i < cifre.length; i++) {
    let d = Number(cifre[cifre.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    somma += d;
  }
  return somma % 10 === 0;
}

function ripulisciTesto(testo: string): string {
  if (!testo) return testo;
  let pulito = testo;
  for (const [forma, alPosto] of NEL_TESTO) {
    // I due rami sono la stessa chiamata: servono a TypeScript per scegliere la firma di `replace`.
    pulito = typeof alPosto === 'string' ? pulito.replace(forma, alPosto) : pulito.replace(forma, alPosto);
  }
  return testoSenzaRecapiti(pulito);
}

/** L'errore che va a Sentry, col testo ripulito. Se non c'è niente da togliere resta lo stesso oggetto. */
function erroreRipulito(err: unknown): unknown {
  if (typeof err === 'string') return ripulisciTesto(err);
  if (!(err instanceof Error)) return err;
  const messaggio = ripulisciTesto(err.message);
  const pila = err.stack === undefined ? undefined : ripulisciTesto(err.stack);
  if (messaggio === err.message && pila === err.stack) return err;
  const copia = new Error(messaggio);
  copia.name = err.name;
  copia.stack = pila;
  return copia;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (typeof value === 'string') return ripulisciTesto(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  // #232 — Un Error va trattato per quello che è, PRIMA del ramo «oggetto».
  // Un Error non ha proprietà enumerabili: Object.entries() su di lui torna
  // una lista vuota, quindi finiva nel log come `{}`. In settantuno chiamate
  // su ottantaquattro l'errore era il secondo argomento, quindi nei log
  // restava la frase («rimborso fallito») e spariva il motivo. Chi apriva il
  // log dopo un rimborso fallito leggeva: rimborso fallito, {}.
  if (value instanceof Error) {
    return {
      name: value.name,
      message: ripulisciTesto(value.message),
      stack: value.stack === undefined ? undefined : ripulisciTesto(value.stack),
    };
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function toCtx(ctx: unknown): Record<string, unknown> | undefined {
  if (ctx === undefined || ctx === null) return undefined;
  let obj: Record<string, unknown>;
  if (typeof ctx === 'string') obj = { detail: ctx };
  else if (typeof ctx === 'object') obj = ctx as Record<string, unknown>;
  else obj = { value: ctx };
  return redact(obj) as Record<string, unknown>;
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

// Emette una riga di log strutturata (JSON) con contesto redatto (🟡-10).
function line(level: string, msg: string, ctx?: LogContext): string {
  return JSON.stringify({ level, msg: ripulisciTesto(msg), ts: new Date().toISOString(), ...(toCtx(ctx) ?? {}) });
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
    if (!eServer) void captureClientWarning(ripulisciTesto(msg), toCtx(ctx));
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
    if (typeof err === 'string' && ctx instanceof Error) {
      errore = ctx;
      contesto = { messaggio: err };
    }
    if (eServer || process.env.NODE_ENV !== 'production') {
      console.error(line('error', errore instanceof Error ? errore.message : String(errore), contesto));
    }
    const c = toCtx(contesto);
    const perSentry = erroreRipulito(errore);
    if (typeof window === 'undefined') {
      // Server (API/cron/webhook): cattura diretta sul SDK server già init'd.
      void captureServerError(perSentry, c);
    } else {
      // Client: wrapper lazy esistente (init Sentry browser al primo errore).
      void captureError(perSentry, c);
    }
  },
};

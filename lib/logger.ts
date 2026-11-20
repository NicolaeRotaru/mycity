import { captureError } from '@/lib/analytics/sentry';

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
  /(email|password|passwd|\bpass\b|token|authorization|\bauth\b|cookie|phone|tel|iban|card|cvv|secret|api[_-]?key|ssn|fiscal|codice_?fiscale|\bcf\b|vat|partita_?iva|pec|address|indirizzo|name|nome|cognome|surname|birth|nascita)/i;

/**
 * 20/11/2026 (R03-021) — IL FILTRO GUARDAVA SOLO I NOMI DELLE CHIAVI.
 *
 * `{ customer_email: … }` usciva oscurato, ma la stessa email scritta nel testo del messaggio
 * («invio fallito a maria@example.it»), in un contesto passato come stringa (finiva in chiaro sotto
 * `detail`) o nel valore di una chiave innocua (`{ errore: '… Bearer eyJ…' }`) passava intera, sulla
 * console e su Sentry. Adesso ogni testo si ripulisce per CONTENUTO, con le famiglie della lista
 * qui sopra che si riconoscono dalla forma: gettoni e chiavi, IBAN, carte, codice fiscale, email e
 * telefoni. Nomi e indirizzi in un testo libero non hanno una forma: restano affidati alle chiavi.
 *
 * Nei log passano soprattutto numeri: d'ordine, importi in centesimi, durate, timestamp. Devono
 * uscire identici, se no il log non serve più a capire cosa è successo. Per questo le forme sono
 * strette: l'IBAN deve tornare col suo controllo, la carta deve cominciare come una carta e
 * passare Luhn, il telefono deve avere il prefisso o i separatori (la regola del filmato,
 * `testoSenzaRecapiti`, oscura ogni fila di 8–12 cifre che comincia con 0 o 3: lì va bene, qui
 * si mangerebbe «#30012345» e «durata 312345678 ns»).
 */
const NASCOSTO = '[redacted]';

/**
 * Limite di lunghezza del testo ripulito: oltre `LUNGHEZZA_MASSIMA` caratteri il testo si tronca
 * PRIMA di passare alle regole, e finisce col segno `…[troncato]`. La parola tagliata a metà si
 * toglie tutta (se comincia entro `INDIETRO_AL_MASSIMO` caratteri dal taglio): mezza email o mezzo
 * gettone non si riconoscerebbero più e uscirebbero in chiaro.
 */
const LUNGHEZZA_MASSIMA = 8000;
const INDIETRO_AL_MASSIMO = 256;
const SEGNO_DEL_TAGLIO = '…[troncato]';
const PEZZO_DI_PAROLA = /[\w.+@%/=~-]/;

// L'email: la forma di `UN_EMAIL` in lib/analytics/filmato-senza-dati-personali.ts (il dominio
// finisce in lettere: `react@18.3.1` non è un'email), che comincia dove comincia la parola.
const UN_EMAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?![\w-])(?!\.[\w-])/gi;
// Il telefono italiano: prefisso +39 / 0039 facoltativo, poi un cellulare (3xx) o un fisso (0x…),
// anche fra parentesi, con spazi, punti, trattini o barre. Prima e dopo niente lettere, cifre,
// trattini o barre (uuid e percorsi restano). Quale candidato è davvero un telefono lo dice
// `eUnTelefono`.
const UN_TELEFONO = /(?:(?<![\w\-/])|(?<=%20))((?:\+|00)39[\s.-]?)?\(?(?:3\d{2}|0\d{1,3})\)?(?:[\s.\-/]?\d){5,8}(?![\w\-/])/g;
// Ha la forma di un telefono ma non lo è: date («05.11.2026»), decimali («314.15926»), migliaia
// col punto («350.000.000»).
const NON_E_UN_TELEFONO = /^(?:\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d+\.\d+|\d{1,3}(?:\.\d{3})+)$/;

const NEL_TESTO: ReadonlyArray<readonly [RegExp, string | ((trovato: string, ...gruppi: string[]) => string)]> = [
  // Gettoni e chiavi: «Bearer …», i JWT (anche la chiave di servizio di Supabase), le chiavi
  // segrete di Stripe, dei webhook, di Supabase e di Anthropic.
  [/\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [redacted]'],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]+)?/g, NASCOSTO],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, NASCOSTO],
  [/\b(?:whsec|sb_secret)_[A-Za-z0-9_-]{8,}/g, NASCOSTO],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, NASCOSTO],
  // «password=…», «token: …», «"api_key":"…», «x-api-key: …», «csrf_token=…»: il nome resta, il
  // valore no. Dopo «Authorization:» il valore è tutto: «Basic <credenziali>» sparisce intero.
  [
    /\b(password|passwd|access_token|refresh_token|id_token|csrf_token|xsrf_token|token|client_secret|secret|api[_-]?key|apikey|authorization)("?\s*[=:]\s*)((?:Basic|Bearer|Digest)\s+[^\s"',;&]+|"[^"]*"|'[^']*'|[^\s"',;&]+)/gi,
    '$1$2[redacted]',
  ],
  // IBAN: tutto attaccato o a gruppi di quattro separati da uno spazio, e col controllo (modulo 97)
  // che torna. Così «ORDINE AB12 CONFERMATO PER…» resta com'è.
  [
    /\b[A-Z]{2}\d{2}(?:[A-Z0-9]{11,30}|(?: [A-Z0-9]{4}){2,7}(?: [A-Z0-9]{1,3})?)\b/g,
    (trovato) => (ibanValido(trovato) ? NASCOSTO : trovato),
  ],
  // Codice fiscale.
  [/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi, NASCOSTO],
  // Carte: da 13 a 19 cifre, anche a gruppi, che cominciano come una carta e passano Luhn. I
  // confini non toccano gli identificativi (uuid, codici con lettere o trattini attaccati).
  [/(?<![\w-])\d(?:[ -]?\d){12,18}(?![\w-])/g, (trovato) => (sembraUnaCarta(trovato.replace(/\D/g, '')) ? NASCOSTO : trovato)],
  [UN_EMAIL, NASCOSTO],
  [UN_TELEFONO, (trovato, prefisso) => (eUnTelefono(trovato, prefisso) ? NASCOSTO : trovato)],
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

/**
 * Le carte cominciano con 3 (Amex, Diners, JCB), 4 (Visa), 5 (Mastercard, Maestro), 6 (Discover,
 * Maestro, UnionPay) o 2 (Mastercard, solo a 16 cifre). Un timestamp in millisecondi, microsecondi
 * o nanosecondi (17…) e un numero con lo zero davanti non sono carte.
 */
function sembraUnaCarta(cifre: string): boolean {
  const prima = cifre[0];
  if (prima === '2') return cifre.length === 16 && passaLuhn(cifre);
  return prima >= '3' && prima <= '6' && passaLuhn(cifre);
}

/** Il controllo dell'IBAN: le prime quattro in fondo, le lettere in numeri (A=10 … Z=35), resto 1 su 97. */
function ibanValido(trovato: string): boolean {
  const iban = trovato.replace(/ /g, '');
  let resto = 0;
  for (const c of iban.slice(4) + iban.slice(0, 4)) {
    const v = c >= 'A' ? c.charCodeAt(0) - 55 : Number(c);
    resto = (resto * (v > 9 ? 100 : 10) + v) % 97;
  }
  return resto === 1;
}

/**
 * Col prefisso (+39, 0039) o coi separatori («333 123 4567», «0532/123456», «(02) 12345678») è un
 * telefono. Una fila di sole cifre no — è un numero d'ordine, un importo, una durata — salvo il
 * cellulare scritto tutto attaccato: 10 cifre, 3 e poi da 1 a 9 («3331234567»).
 */
function eUnTelefono(trovato: string, prefisso: string | undefined): boolean {
  if (prefisso) return true;
  if (NON_E_UN_TELEFONO.test(trovato)) return false;
  if (/^\d+$/.test(trovato)) return /^3[1-9]\d{8}$/.test(trovato);
  return true;
}

/** Qualunque cosa arrivi al posto di un testo (un numero, un Error, una pila che non è un testo) diventa un testo, senza lanciare. */
function inTesto(valore: unknown): string {
  if (typeof valore === 'string') return valore;
  try {
    return String(valore);
  } catch {
    return '[non leggibile]';
  }
}

/** Il pezzo che passa alle regole quando il testo supera il limite di lunghezza. */
function tagliatoAlLimite(testo: string): string {
  let fine = LUNGHEZZA_MASSIMA;
  const minimo = LUNGHEZZA_MASSIMA - INDIETRO_AL_MASSIMO;
  while (fine > minimo && PEZZO_DI_PAROLA.test(testo[fine])) fine--;
  return testo.slice(0, fine > minimo ? fine : LUNGHEZZA_MASSIMA);
}

function ripulisciTesto(valore: unknown): string {
  const testo = inTesto(valore);
  if (!testo) return testo;
  const troppoLungo = testo.length > LUNGHEZZA_MASSIMA;
  let pulito = troppoLungo ? tagliatoAlLimite(testo) : testo;
  for (const [forma, alPosto] of NEL_TESTO) {
    // I due rami sono la stessa chiamata: servono a TypeScript per scegliere la firma di `replace`.
    pulito = typeof alPosto === 'string' ? pulito.replace(forma, alPosto) : pulito.replace(forma, alPosto);
  }
  return troppoLungo ? pulito + SEGNO_DEL_TAGLIO : pulito;
}

/**
 * L'errore che va a Sentry, col testo ripulito. Se non c'è niente da togliere resta lo stesso
 * oggetto. Un errore-oggetto semplice (gli errori di Supabase: `{ message, details, code }`)
 * passa per la stessa pulizia del contesto.
 */
function erroreRipulito(err: unknown): unknown {
  if (typeof err === 'string') return ripulisciTesto(err);
  if (err instanceof Error) {
    const messaggio = ripulisciTesto(err.message);
    const pila = err.stack === undefined ? undefined : ripulisciTesto(err.stack);
    if (messaggio === err.message && pila === err.stack) return err;
    const copia = new Error(messaggio);
    copia.name = inTesto(err.name);
    copia.stack = pila;
    return copia;
  }
  if (err !== null && typeof err === 'object') return redact(err);
  return err;
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
  try {
    return redact(obj) as Record<string, unknown>;
  } catch {
    // Un contesto che non si lascia leggere (un getter che lancia) non deve far lanciare il logger.
    return { contesto: '[non leggibile]' };
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

// Emette una riga di log strutturata (JSON) con contesto redatto (🟡-10).
function line(level: string, msg: unknown, ctx?: LogContext): string {
  const testo = ripulisciTesto(msg);
  const ts = new Date().toISOString();
  try {
    return JSON.stringify({ level, msg: testo, ts, ...(toCtx(ctx) ?? {}) });
  } catch {
    // Un contesto che non si scrive (un giro circolare in fondo, un BigInt): resta la riga col messaggio.
    return JSON.stringify({ level, msg: testo, ts, contesto: '[non scrivibile]' });
  }
}

/**
 * 20/11/2026 (R03-021) — IL LOGGER NON LANCIA MAI.
 *
 * Chi scrive un log sta già gestendo un guaio: se il logger lancia, il guaio diventa un altro (un
 * `catch` che salta, una risposta che non parte). Messaggi e pile che non sono testi si convertono
 * (`inTesto`); quello che resta lo ferma qui. Il lavoro verso Sentry parte dopo, e un suo rifiuto
 * non resta senza gestione.
 */
function senzaLanciare(scrivi: () => void): void {
  try {
    scrivi();
  } catch {
    // Niente: il log perso è meno grave del chiamante che si rompe.
  }
}

function inSottofondo(lavoro: unknown): void {
  void Promise.resolve(lavoro).catch(() => undefined);
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
  info: (msg: string, ctx?: LogContext) =>
    senzaLanciare(() => {
      if (process.env.NODE_ENV !== 'production' || process.env.LOG_LEVEL === 'info') {
        console.log(line('info', msg, ctx));
      }
    }),

  /**
   * #195 — La spesa. Non e' un messaggio di servizio: e' un numero che deve
   * restare. Prima usciva con `logger.info`, che in produzione e' spento se
   * LOG_LEVEL non vale 'info' — e infatti non e' impostato in produzione.
   * Risultato: quanto costa l'AI in produzione non si vedeva da nessuna parte.
   * Questa esce sempre, come gli avvisi, e resta riconoscibile per grep.
   */
  spesa: (msg: string, ctx?: LogContext) =>
    senzaLanciare(() => {
      console.log(line('spesa', msg, ctx));
    }),

  warn: (msg: string, ctx?: LogContext) =>
    senzaLanciare(() => {
      // Sempre: un avviso in produzione e' esattamente quello che si va a cercare.
      console.warn(line('warn', msg, ctx));
      if (!eServer) inSottofondo(captureClientWarning(ripulisciTesto(msg), toCtx(ctx)));
    }),

  error: (err: unknown, ctx?: LogContext) =>
    senzaLanciare(() => {
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
        console.error(line('error', errore instanceof Error ? errore.message : errore, contesto));
      }
      const c = toCtx(contesto);
      const perSentry = erroreRipulito(errore);
      if (typeof window === 'undefined') {
        // Server (API/cron/webhook): cattura diretta sul SDK server già init'd.
        inSottofondo(captureServerError(perSentry, c));
      } else {
        // Client: wrapper lazy esistente (init Sentry browser al primo errore).
        inSottofondo(captureError(perSentry, c));
      }
    }),
};

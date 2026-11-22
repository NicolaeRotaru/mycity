/**
 * Le impostazioni del registratore degli errori, in un posto solo.
 *
 * #236 — L'accensione stava dentro un `useEffect` di un componente React
 * (SentryProvider), cioè partiva DOPO il primo disegno della pagina. Il guasto
 * peggiore — quello che rompe l'applicazione mentre si carica, prima che React
 * arrivi a montare qualcosa — succedeva sempre prima, e non veniva registrato
 * da nessuno. Il registratore era acceso per tutti gli errori tranne il tipo
 * che conta di più.
 *
 * Ora l'accensione vive in `instrumentation-client.ts`, che Next esegue prima
 * del primo disegno. Le impostazioni sono qui perché le usano tutti e due.
 */

import { hasConsent } from '@/lib/consent';
import { ambienteSentry } from './ambiente';
import { indirizzoSenzaDatiPersonali, VALORE_NASCOSTO } from './indirizzo-senza-dati-personali';
import { testoSenzaIndirizzi } from './filmato-senza-dati-personali';

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

/** La quota delle misure di velocità adesso: 10% col consenso statistico, altrimenti niente. */
export function quotaDelleMisure(): number {
  return typeof window !== 'undefined' && hasConsent('analytics') ? 0.1 : 0;
}

export function opzioniSentry() {
  // La registrazione dello schermo (session replay) resta legata al consenso:
  // è l'unica parte che riprende quello che la persona fa. Il resto — gli
  // errori — è interesse legittimo e non aspetta il banner.
  const analyticsOk = typeof window !== 'undefined' && hasConsent('analytics');
  return {
    dsn: SENTRY_DSN,
    // S10 (5/11/2026) — Le misure di velocità partivano dal 10% delle pagine
    // anche senza consenso, con l'indirizzo intero. Adesso solo col consenso
    // statistico, e passano dalla stessa pulizia degli errori.
    //
    // 12/11/2026 (R08-023) — Il consenso si chiede A OGNI MISURA, non una volta all'avvio.
    // Prima qui c'era `tracesSampleRate: analyticsOk ? 0.1 : 0`: un numero calcolato quando
    // la pagina partiva. Chi toglieva il consenso dal banner continuava a essere misurato
    // su una pagina su dieci finché non ricaricava — e il sito è a pagina singola, si
    // naviga a lungo senza ricaricare. La revoca deve valere subito (art. 7.3 GDPR).
    // Sentry chiama `tracesSampler` all'inizio di ogni misura.
    tracesSampler: () => quotaDelleMisure(),
    replaysSessionSampleRate: analyticsOk ? 0.05 : 0,
    replaysOnErrorSampleRate: analyticsOk ? 1.0 : 0,
    // R187 — `NODE_ENV` su Vercel dice `production` anche per le anteprime.
    environment: ambienteSentry(),
    // 🟡-11: non inviare PII di default (IP/cookie/header). Esplicito anche se è
    // il default dell'SDK, così non regredisce se cambia in futuro.
    sendDefaultPii: false,
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      'AbortError',
      'NetworkError when attempting to fetch resource',
    ],
    beforeSendTransaction(event: any): any {
      return ripulisciEvento(event);
    },
    beforeSend(event: any): any {
      return ripulisciEvento(event);
    },
  };
}

/**
 * La pulizia dei dati personali, una sola per errori e misure (S10, 5/11/2026):
 * prima valeva solo per gli errori (beforeSend), e le misure di velocità
 * mandavano l'indirizzo intero della pagina.
 */
export function ripulisciEvento(event: any): any {
  // 🟡-11: scrub difensivo di PII — cookie, header (Authorization), body e
  // identità utente (teniamo solo l'id per correlare, mai email/ip).
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    /**
     * 27/8/2026 (R161) — L'INDIRIZZO DELLA PAGINA USCIVA INTERO.
     *
     * Questa pulizia cancellava cookie, intestazioni e corpo, e lasciava
     * `request.url`. Ma l'errore che si vuole di più è proprio quello che
     * scoppia mentre qualcuno cerca, e l'indirizzo di quella pagina è
     * `/search?q=…`: cioè il testo che la persona aveva appena scritto,
     * allegato all'errore e mandato fuori. Stessa cosa per
     * `query_string`, che è la stessa informazione nel campo accanto.
     */
    if (typeof event.request.url === 'string') {
      const pulito = indirizzoSenzaDatiPersonali(event.request.url);
      if (pulito) event.request.url = pulito;
      else delete event.request.url;
    }
    delete event.request.query_string;
  }
  /**
   * 27/8/2026 (R161) — Le briciole raccontano da quale pagina a quale
   * pagina si è passati: sono indirizzi anche loro, e portavano dentro la
   * stessa ricerca.
   */
  if (Array.isArray(event.breadcrumbs)) {
    for (const briciola of event.breadcrumbs) {
      const dati = briciola?.data;
      if (!dati || typeof dati !== 'object') continue;
      for (const campo of ['url', 'from', 'to'] as const) {
        if (typeof dati[campo] !== 'string') continue;
        const pulito = indirizzoSenzaDatiPersonali(dati[campo]);
        if (pulito) dati[campo] = pulito;
        else delete dati[campo];
      }
    }
  }
  // Revisione S10 — Le misure portano anche gli span (chiamate di rete della
  // pagina): descrizione e dati possono contenere l'indirizzo con la ricerca.
  if (Array.isArray(event.spans)) {
    for (const span of event.spans) {
      if (typeof span?.description === 'string' && /[/?]/.test(span.description)) {
        const [metodo, ...resto] = span.description.split(' ');
        const indirizzo = resto.length ? resto.join(' ') : metodo;
        const pulito = indirizzoSenzaDatiPersonali(indirizzo);
        span.description = pulito ? (resto.length ? `${metodo} ${pulito}` : pulito) : '[nascosto]';
      }
      ripulisciDatiDelloSpan(span?.data);
    }
  }
  /**
   * 17/11/2026 (R32-025) — LA MISURA STESSA PORTAVA L'INDIRIZZO INTERO.
   *
   * Gli span figli erano ripuliti, la misura no: l'SDK scrive l'indirizzo della pagina
   * (`url.full`, con la ricerca e il pezzo dopo il cancelletto) nei dati della misura,
   * `contexts.trace.data`, e sul server anche `http.target`, `http.url` e il `referer`.
   * Gli errori del server lo allegano in `contexts.nextjs.request_path`.
   */
  ripulisciDatiDelloSpan(event.contexts?.trace?.data);
  if (event.contexts?.nextjs && typeof event.contexts.nextjs.request_path === 'string') {
    const pulito = indirizzoSenzaDatiPersonali(event.contexts.nextjs.request_path);
    if (pulito) event.contexts.nextjs.request_path = pulito;
    else delete event.contexts.nextjs.request_path;
  }
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
  }
  ripulisciIlTestoLibero(event);
  return event;
}

/**
 * IL TESTO LIBERO DELL'EVENTO. Il messaggio, il valore dell'eccezione, le briciole e i dati
 * aggiunti (`extra` — il registratore ci mette il contesto di ogni avviso —, `tags`, i contesti
 * dell'applicazione) possono portare un'email, un telefono, un indirizzo di casa, un IBAN o una
 * chiave. Le stringhe si ripuliscono con la stessa rete del filmato (email, telefono, indirizzi con
 * parametri) più chiavi, IBAN e indirizzi di casa; un campo che dal nome porta un dato personale o
 * una chiave si nasconde intero. I contesti che scrive l'SDK (sistema, browser, dispositivo,
 * misura) non portano dati scritti da qualcuno e restano come sono.
 */
const CONTESTI_DELL_SDK = new Set(['trace', 'os', 'browser', 'device', 'runtime', 'app', 'culture', 'cloud_resource']);

function ripulisciIlTestoLibero(event: any): void {
  try {
    ripulisciIlTestoLiberoDentro(event);
  } catch {
    // Una struttura che non si lascia riscrivere: l'errore parte lo stesso, senza il testo libero.
    delete event.extra;
    delete event.breadcrumbs;
    delete event.logentry;
    if (event.message) event.message = VALORE_NASCOSTO;
    for (const eccezione of Array.isArray(event.exception?.values) ? event.exception.values : []) {
      if (eccezione && typeof eccezione === 'object') eccezione.value = VALORE_NASCOSTO;
    }
  }
}

function ripulisciIlTestoLiberoDentro(event: any): void {
  const conto = { pezzi: 0 };
  if (typeof event.message === 'string') event.message = testoPulitoPerSentry(event.message);
  else if (event.message && typeof event.message === 'object') ripulisciValore(event.message, 0, conto);
  if (event.logentry && typeof event.logentry === 'object') ripulisciValore(event.logentry, 0, conto);
  if (Array.isArray(event.exception?.values)) {
    for (const eccezione of event.exception.values) {
      if (typeof eccezione?.value === 'string') eccezione.value = testoPulitoPerSentry(eccezione.value);
      for (const riga of Array.isArray(eccezione?.stacktrace?.frames) ? eccezione.stacktrace.frames : []) {
        if (riga?.vars && typeof riga.vars === 'object') ripulisciValore(riga.vars, 0, conto);
      }
    }
  }
  if (Array.isArray(event.breadcrumbs)) {
    for (const briciola of event.breadcrumbs) {
      if (typeof briciola?.message === 'string') briciola.message = testoPulitoPerSentry(briciola.message);
      if (briciola?.data && typeof briciola.data === 'object') ripulisciValore(briciola.data, 0, conto);
    }
  }
  if (event.extra && typeof event.extra === 'object') ripulisciValore(event.extra, 0, conto);
  if (event.tags && typeof event.tags === 'object') ripulisciValore(event.tags, 0, conto);
  if (event.contexts && typeof event.contexts === 'object') {
    for (const nome of Object.keys(event.contexts)) {
      if (CONTESTI_DELL_SDK.has(nome)) continue;
      event.contexts[nome] = ripulisciValore(event.contexts[nome], 1, conto);
    }
  }
}

/** Oltre questa profondità e questo numero di pezzi non si scende: si nasconde. */
const PROFONDITA_MASSIMA = 8;
const PEZZI_MASSIMI = 5_000;

function ripulisciValore(valore: unknown, profondita: number, conto: { pezzi: number }): unknown {
  if (typeof valore === 'string') return testoPulitoPerSentry(valore);
  if (!valore || typeof valore !== 'object') return valore;
  if (profondita > PROFONDITA_MASSIMA || ++conto.pezzi > PEZZI_MASSIMI) return VALORE_NASCOSTO;
  const oggetto = valore as Record<string, unknown>;
  for (const chiave of Object.keys(oggetto)) {
    const dentro = oggetto[chiave];
    oggetto[chiave] = !Array.isArray(oggetto) && nomeDaNascondere(chiave) && dentro !== null && dentro !== undefined && dentro !== ''
      ? VALORE_NASCOSTO
      : ripulisciValore(dentro, profondita + 1, conto);
  }
  return oggetto;
}

/** I nomi dei campi che portano un dato personale o una chiave, scritti in qualunque forma. */
const NOMI_DA_NASCONDERE = new Set([
  'email', 'mail', 'e_mail', 'email_address', 'phone', 'phone_number', 'telefono', 'cellulare', 'tel', 'mobile',
  'indirizzo', 'address', 'street', 'via', 'civico', 'cap', 'zip', 'zip_code', 'postal_code', 'delivery_address',
  'token', 'access_token', 'refresh_token', 'id_token', 'api_key', 'apikey', 'password', 'passwd', 'pwd', 'secret',
  'client_secret', 'segreto', 'authorization', 'cookie', 'cookies', 'set_cookie', 'iban', 'codice_fiscale', 'tax_code',
  'fiscal_code', 'piva', 'partita_iva', 'vat_number', 'card_number', 'cvc', 'cvv',
]);
const FINALI_DA_NASCONDERE = /_(?:email|phone|telefono|token|password|secret|address|indirizzo|iban|cookie)$/;

function nomeDaNascondere(chiave: string): boolean {
  const nome = chiave
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-.\s]+/g, '_')
    .toLowerCase();
  return NOMI_DA_NASCONDERE.has(nome) || FINALI_DA_NASCONDERE.test(nome);
}

/**
 * Una stringa ripulita: email, telefoni e indirizzi con parametri come nel filmato
 * (`testoSenzaIndirizzi`), poi le chiavi, l'IBAN e gli indirizzi di casa. Ogni regola qui sotto
 * comincia da una parola intera o da una parola fissa e ha ripetizioni limitate: il tempo cresce
 * con la lunghezza del testo.
 */
export function testoPulitoPerSentry(testo: string): string {
  if (!testo) return testo;
  return testoSenzaIndirizzi(testo)
    .replace(DOPO_BEARER, (_, parola: string) => `${parola} ${VALORE_NASCOSTO}`)
    .replace(UN_PEZZO, (pezzo) => (sembraUnaChiave(pezzo) ? VALORE_NASCOSTO : pezzo))
    .replace(UN_IBAN, VALORE_NASCOSTO)
    .replace(UN_INDIRIZZO_DI_CASA, VALORE_NASCOSTO);
}

const DOPO_BEARER = /\b(Bearer|Basic)\s+[^\s"'<>]+/gi;
// Un pezzo di testo fra spazi e segni (anche «=», «:», «&», «?»): ogni pezzo si guarda intero.
const UN_PEZZO = /[^\s"'<>(),;=:&?]+/g;
const FORME_DI_CHIAVE = [
  /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/, // un token firmato (JWT), come la chiave di Supabase
  /^(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{8,}$/, // Stripe
  /^whsec_[0-9A-Za-z]{8,}$/, // il segreto dei webhook di Stripe
  /_secret_[0-9A-Za-z]{6,}$/, // il segreto di un pagamento di Stripe (pi_…_secret_…)
  /^sk-[\w-]{16,}$/, // le chiavi «sk-…» dei servizi di AI
];
function sembraUnaChiave(pezzo: string): boolean {
  return FORME_DI_CHIAVE.some((forma) => forma.test(pezzo));
}
// IBAN: due lettere maiuscole, due cifre, poi gruppi di quattro (attaccati o con uno spazio).
const UN_IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g;
// Un indirizzo di casa: «via/viale/piazza/corso/…», un nome di al più sessanta caratteri e il civico.
const UN_INDIRIZZO_DI_CASA =
  /\b(?:via|viale|v\.le|piazza|p\.zza|piazzale|corso|c\.so|vicolo|largo|strada|str\.|località|loc\.)\s+[A-Za-zÀ-ÿ'.\s]{2,60}?,?\s*\d{1,4}[A-Za-z]?\b/gi;

/**
 * 17/11/2026 (R32-025) — I campi in cui l'SDK (browser, server, edge) scrive un indirizzo
 * intero: della strada si tiene tutto, dei parametri solo il nome.
 */
const CAMPI_CON_INDIRIZZO = ['url', 'http.url', 'url.full', 'http.target', 'http.request.header.referer'] as const;
/** I campi che portano solo la ricerca, il pezzo dopo il cancelletto o l'indirizzo IP: via. */
const CAMPI_DA_TOGLIERE = ['http.query', 'url.query', 'http.fragment', 'url.fragment', 'http.client_ip', 'client.address'] as const;

function ripulisciDatiDelloSpan(grezzi: unknown): void {
  if (!grezzi || typeof grezzi !== 'object') return;
  const dati = grezzi as Record<string, unknown>;
  for (const campo of CAMPI_CON_INDIRIZZO) {
    if (typeof dati[campo] !== 'string') continue;
    const pulito = indirizzoSenzaDatiPersonali(dati[campo]);
    if (pulito) dati[campo] = pulito;
    else delete dati[campo];
  }
  for (const campo of CAMPI_DA_TOGLIERE) delete dati[campo];
}

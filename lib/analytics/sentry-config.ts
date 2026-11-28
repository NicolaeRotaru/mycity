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
import { indirizzoSenzaDatiPersonali } from './indirizzo-senza-dati-personali';
import { testoSenzaRecapiti } from './filmato-senza-dati-personali';

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
  /**
   * 28/11/2026 (R10-008, onda 2) — IL TESTO DELL'ERRORE USCIVA COM'ERA.
   *
   * Il logger oscura email e telefoni prima di passare a Sentry, ma gli errori che dal logger non
   * passano arrivavano qui in chiaro: `onRequestError` del server (instrumentation.ts), le pagine
   * di errore (gli error.tsx sotto app/ e app/global-error.tsx), le promesse rifiutate del browser
   * (lib/analytics/sentry.tsx), l'edge. «Nessun ordine per mario.rossi@gmail.com» o «telefono
   * 333 1234567 non valido» finivano nel titolo dell'errore. Qui passa ogni evento (beforeSend del
   * server, dell'edge e del browser): il testo dell'eccezione, il messaggio e le briciole della
   * console si ripuliscono con la stessa rete del filmato dello schermo.
   */
  if (Array.isArray(event.exception?.values)) {
    for (const ex of event.exception.values) {
      if (typeof ex?.value === 'string') ex.value = testoSenzaRecapiti(ex.value);
    }
  }
  if (typeof event.message === 'string') event.message = testoSenzaRecapiti(event.message);
  if (typeof event.logentry?.message === 'string') event.logentry.message = testoSenzaRecapiti(event.logentry.message);
  if (Array.isArray(event.breadcrumbs)) {
    for (const briciola of event.breadcrumbs) {
      if (typeof briciola?.message === 'string') briciola.message = testoSenzaRecapiti(briciola.message);
      // R10-008 (collaudo) — La briciola della console porta anche gli argomenti com'erano
      // (`data.arguments`, integrazione console dell'SDK): il messaggio qui sopra è la loro copia
      // unita e oscurata, quindi gli argomenti grezzi non partono.
      if (briciola?.data && typeof briciola.data === 'object' && 'arguments' in briciola.data) {
        delete briciola.data.arguments;
      }
    }
  }
  return event;
}

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

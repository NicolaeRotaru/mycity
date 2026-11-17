import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R32-025 — LA PULIZIA DEI DATI PERSONALI VERSO SENTRY COPRIVA SOLO GLI ERRORI DEL BROWSER.
 *
 * Le misure di velocità del browser passavano dalla pulizia, ma l'SDK scrive l'indirizzo
 * intero della pagina anche nei dati della misura stessa (`contexts.trace.data['url.full']`,
 * ricerca e pezzo dopo il cancelletto compresi), che nessuno toccava. Sul server e nel
 * middleware (edge) non c'era nessuna pulizia: errori e misure partivano con `request.url`,
 * `query_string`, `contexts.nextjs.request_path`, `http.target`, `url.full` e il `referer`.
 *
 * La prova accende le tre configurazioni vere (quella del server e quella dell'edge con un
 * Sentry finto che si tiene le opzioni) e fa passare eventi costruiti come li costruisce l'SDK.
 */

const init = vi.fn();
vi.mock('@sentry/nextjs', () => ({ init }));

const PAGINA = 'https://mycity.test/search?q=mario.rossi%40gmail.com&page=2#access_token=gettone-segreto';
const PERSONALI = /mario|gmail|gettone|segreto|1\.2\.3\.4/;

type Opzioni = {
  beforeSend: (e: any, hint?: any) => any;
  beforeSendTransaction?: (e: any) => any;
};

/** Un errore del server come lo prepara l'SDK di Next (captureRequestError + richiesta normalizzata). */
function erroreDelServer() {
  return {
    exception: { values: [{ type: 'Error', value: 'scoppiato' }] },
    request: { url: PAGINA, method: 'GET', query_string: 'q=mario.rossi%40gmail.com' },
    contexts: {
      nextjs: { request_path: '/search?q=mario.rossi%40gmail.com', router_kind: 'App Router', route_type: 'render' },
      trace: { trace_id: 't', span_id: 's', data: { 'url.full': PAGINA, 'http.target': '/search?q=mario.rossi%40gmail.com' } },
    },
  };
}

/** Una misura del server: lo span della richiesta con i suoi attributi. */
function misuraDelServer() {
  return {
    type: 'transaction',
    transaction: 'GET /search',
    contexts: {
      trace: {
        trace_id: 't',
        span_id: 's',
        op: 'http.server',
        data: {
          'url.full': PAGINA,
          'url.path': '/search',
          'http.url': PAGINA,
          'http.target': '/search?q=mario.rossi%40gmail.com',
          'http.client_ip': '1.2.3.4',
          'http.request.header.referer': 'https://mycity.test/search?q=mario.rossi%40gmail.com',
        },
      },
    },
    spans: [],
  };
}

async function accendi(file: '@/sentry.server.config' | '@/sentry.edge.config'): Promise<Opzioni> {
  vi.resetModules();
  init.mockClear();
  process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://chiave@sentry.invalid/1';
  await import(file);
  expect(init, `${file} non ha acceso Sentry`).toHaveBeenCalledTimes(1);
  return init.mock.calls[0][0] as Opzioni;
}

let dsnPrima: string | undefined;
beforeEach(() => {
  dsnPrima = process.env.NEXT_PUBLIC_SENTRY_DSN;
});
afterEach(() => {
  if (dsnPrima === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = dsnPrima;
});

describe('R32-025 · verso Sentry non esce l\'indirizzo intero della pagina', () => {
  it('IL CASO CHE ROMPEVA — browser: la misura di velocità non porta la ricerca nei suoi dati (url.full)', async () => {
    vi.resetModules();
    const { opzioniSentry } = await import('@/lib/analytics/sentry-config');
    const o = opzioniSentry() as unknown as Opzioni;
    const e = o.beforeSendTransaction!({
      type: 'transaction',
      transaction: '/search',
      request: { url: PAGINA },
      contexts: { trace: { trace_id: 't', span_id: 's', op: 'pageload', data: { 'url.full': PAGINA, 'url.path': '/search' } } },
      measurements: { lcp: { value: 1200, unit: 'millisecond' } },
      spans: [{ description: 'GET /api/x', data: { 'url.full': PAGINA, 'url.query': '?q=mario' } }],
    });
    expect(JSON.stringify(e)).not.toMatch(PERSONALI);
    // La strada resta (serve a sapere quale pagina è lenta), i nomi dei parametri anche.
    expect(e.contexts.trace.data['url.full']).toBe('https://mycity.test/search?q=***&page=2');
    expect(e.contexts.trace.data['url.path']).toBe('/search');
    expect(e.measurements.lcp.value).toBe(1200);
  });

  it('IL CASO CHE ROMPEVA — server: l\'errore parte senza la ricerca (request, query_string, request_path, trace)', async () => {
    const o = await accendi('@/sentry.server.config');
    const e = o.beforeSend(erroreDelServer(), { originalException: new Error('scoppiato') });
    expect(e, 'l\'errore vero non deve sparire').toBeTruthy();
    expect(JSON.stringify(e)).not.toMatch(PERSONALI);
    expect(e.request.url).toBe('https://mycity.test/search?q=***&page=2');
    expect(e.contexts.nextjs.request_path).toBe('/search?q=***');
    expect(e.contexts.nextjs.route_type).toBe('render');
    // Gli errori di rate limit restano scartati come prima.
    expect(o.beforeSend(erroreDelServer(), { originalException: new Error('Too Many Requests') })).toBeNull();
  });

  it('IL CASO CHE ROMPEVA — server: la misura della richiesta parte senza ricerca, referer con ricerca e IP', async () => {
    const o = await accendi('@/sentry.server.config');
    const pulisci = o.beforeSendTransaction ?? ((x: any) => x);
    const e = pulisci(misuraDelServer());
    expect(JSON.stringify(e)).not.toMatch(PERSONALI);
    expect(e.contexts.trace.data['http.target']).toBe('/search?q=***');
    expect(e.contexts.trace.data['url.path']).toBe('/search');
    expect(e.transaction).toBe('GET /search');
  });

  it('IL CASO CHE ROMPEVA — edge (middleware): errori e misure passano dalla stessa pulizia', async () => {
    const o = await accendi('@/sentry.edge.config');
    const pulisciErrore = o.beforeSend ?? ((x: any) => x);
    const pulisciMisura = o.beforeSendTransaction ?? ((x: any) => x);
    expect(JSON.stringify(pulisciErrore(erroreDelServer(), {}))).not.toMatch(PERSONALI);
    expect(JSON.stringify(pulisciMisura(misuraDelServer()))).not.toMatch(PERSONALI);
  });
});

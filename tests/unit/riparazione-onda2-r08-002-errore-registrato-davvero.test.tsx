// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 28/11/2026 (R08-002, onda 2) — «ABBIAMO REGISTRATO IL PROBLEMA», MA L'ERRORE NEL TELEFONO NON LO
 * REGISTRAVA NESSUNO.
 *
 * Le pagine d'errore dicevano la frase col solo DSN configurato. Due strade la rendevano falsa:
 *  · il registratore si accende quando il suo pezzo di codice arriva dalla rete (instrumentation-client):
 *    su un telefono lento l'errore che rompe la pagina arriva prima, e `captureException` senza un
 *    client acceso restituisce un id e non spedisce niente;
 *  · il pezzo dell'SDK non si scarica (la stessa rete che ha rotto la pagina): `captureError` usciva in
 *    silenzio.
 * Adesso `captureError` accende il registratore se non lo è ancora e dice se ha consegnato; la pagina
 * dice «registrato» solo dopo quel sì. Qui il registratore (l'SDK) è finto, `captureError` e le pagine
 * sono quelli veri.
 */

const DSN = 'https://abc@o1.ingest.sentry.io/2';

type FintoSdk = {
  client: unknown;
  init: ReturnType<typeof vi.fn>;
  captureException: ReturnType<typeof vi.fn>;
  getClient: () => unknown;
  ordine: string[];
};

function sdkNonAncoraAcceso(opzioni: { initNonAccende?: boolean } = {}): FintoSdk {
  const sdk = {
    client: undefined as unknown,
    ordine: [] as string[],
  } as FintoSdk;
  sdk.getClient = () => sdk.client;
  sdk.init = vi.fn(() => {
    sdk.ordine.push('init');
    if (!opzioni.initNonAccende) sdk.client = { acceso: true };
  });
  sdk.captureException = vi.fn(() => {
    // Come l'SDK vero: senza client l'evento non va da nessuna parte.
    sdk.ordine.push(sdk.client ? 'spedito' : 'buttato');
    return 'id-evento';
  });
  return sdk;
}

function conRegistratore(dsn: string | undefined, sdk: FintoSdk | 'non-si-scarica') {
  vi.doMock('@/lib/analytics/sentry-config', () => ({ SENTRY_DSN: dsn, opzioniSentry: () => ({ dsn }) }));
  vi.doMock('@sentry/nextjs', () => {
    if (sdk === 'non-si-scarica') throw new Error('ChunkLoadError: Loading chunk sentry failed');
    return { init: sdk.init, captureException: sdk.captureException, getClient: sdk.getClient };
  });
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

let root: Root;
let c: HTMLDivElement;

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
});
afterEach(() => {
  act(() => root.unmount());
  c.remove();
  vi.restoreAllMocks();
  vi.doUnmock('@sentry/nextjs');
  vi.doUnmock('@/lib/analytics/sentry-config');
});

describe('R08-002 · captureError dice se l’errore è arrivato al registratore', () => {
  it('errore prima che il registratore sia acceso: lo accende e poi consegna, invece di buttarlo', async () => {
    const sdk = sdkNonAncoraAcceso();
    conRegistratore(DSN, sdk);
    const { captureError } = await import('@/lib/analytics/sentry');

    const consegnato = await captureError(new Error('pagina rotta al caricamento'), { area: 'rider' });

    expect(sdk.ordine, 'l’errore è partito verso un registratore spento: buttato in silenzio').toEqual(['init', 'spedito']);
    expect(consegnato).toBe(true);
  });

  it('registratore già acceso: consegna e basta, senza riaccenderlo', async () => {
    const sdk = sdkNonAncoraAcceso();
    sdk.client = { acceso: true };
    conRegistratore(DSN, sdk);
    const { captureError } = await import('@/lib/analytics/sentry');
    expect(await captureError(new Error('x'))).toBe(true);
    expect(sdk.ordine).toEqual(['spedito']);
  });

  it('il pezzo del registratore non si scarica: risponde no', async () => {
    conRegistratore(DSN, 'non-si-scarica');
    const { captureError } = await import('@/lib/analytics/sentry');
    expect(await captureError(new Error('x'))).toBe(false);
  });

  it('il registratore non si accende: risponde no e non finge di spedire', async () => {
    const sdk = sdkNonAncoraAcceso({ initNonAccende: true });
    conRegistratore(DSN, sdk);
    const { captureError } = await import('@/lib/analytics/sentry');
    expect(await captureError(new Error('x'))).toBe(false);
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it('senza DSN: risponde no', async () => {
    conRegistratore(undefined, sdkNonAncoraAcceso());
    const { captureError } = await import('@/lib/analytics/sentry');
    expect(await captureError(new Error('x'))).toBe(false);
  });
});

const PAGINE = {
  sito: () => import('@/app/error'),
  admin: () => import('@/app/admin/error'),
  venditore: () => import('@/app/seller/error'),
  fattorino: () => import('@/app/rider/error'),
} as const;

async function disegna(pagina: keyof typeof PAGINE): Promise<string> {
  const mod = await PAGINE[pagina]();
  await act(async () => {
    root.render(createElement(mod.default, { error: Object.assign(new Error('x'), { digest: 'd1' }), reset: () => {} }));
  });
  // La consegna passa dall'import dell'SDK: si lascia finire.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return c.textContent ?? '';
}

describe.each(Object.keys(PAGINE) as Array<keyof typeof PAGINE>)('R08-002 · pagina d’errore: %s', (pagina) => {
  it('col DSN ma col registratore che non si scarica, non dice «registrato»', async () => {
    conRegistratore(DSN, 'non-si-scarica');
    const testo = await disegna(pagina);
    expect(testo, 'dice «abbiamo registrato» per un errore che non ha ricevuto nessuno').not.toContain('registrato');
    expect(testo).toContain('Riprova fra un momento');
  });

  it('errore nei primi istanti, col registratore non ancora acceso: lo registra davvero e lo dice', async () => {
    const sdk = sdkNonAncoraAcceso();
    conRegistratore(DSN, sdk);
    const testo = await disegna(pagina);
    expect(sdk.ordine).toEqual(['init', 'spedito']);
    expect(testo).toContain('Abbiamo registrato il problema');
  });
});

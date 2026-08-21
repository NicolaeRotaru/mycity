import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #208 — L'ACQUISTO VENIVA CONTATO SOLO SE IL CLIENTE TORNAVA SULLA PAGINA
 * ORDINI.
 *
 * L'evento partiva unicamente dal browser. Chi chiudeva la scheda dopo aver
 * pagato aveva un ordine nel database e nessun acquisto in PostHog: il
 * fatturato misurato era più basso di quello vero di una quantità che nessuno
 * conosce, e ogni tasso di conversione e ogni ritorno di campagna poggiava su
 * quel numero. Diventa un bloccante il giorno in cui parte spesa pubblicitaria
 * vera, perché si deciderebbe il budget su un numero falso.
 *
 * Ora parte anche dal server, dove il fatto è certo: l'ordine è appena stato
 * scritto.
 */

const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const inviato: Array<{ url: string; corpo: Record<string, unknown> }> = [];

beforeEach(() => {
  inviato.length = 0;
  logger.warn.mockClear();
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_finta');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    inviato.push({ url: String(url), corpo: JSON.parse(String(init?.body ?? '{}')) });
    return new Response('{"status":1}', { status: 200 });
  }));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const acquisto = {
  orderId: '11111111-1111-1111-1111-111111111111',
  buyerId: 'cliente-1',
  totalCents: 3400,
  paymentMethod: 'card' as const,
  sellerId: 'negozio-1',
  checkoutId: 'carrello-9',
  consensoAnalytics: true,
};

describe('l acquisto si conta dove il fatto è certo', () => {
  it('chi ha detto no ai cookie non finisce comunque a PostHog', async () => {
    // 21/8/2026 — Il browser il consenso lo rispettava, il server no: su OGNI
    // ordine partiva verso gli Stati Uniti un dato d'acquisto legato
    // all'identificativo della persona, anche da chi aveva risposto no. Due
    // pagine pubbliche promettono che quel no viene rispettato.
    const { contaAcquisto } = await import('@/lib/analytics/server');
    await contaAcquisto({ ...acquisto, consensoAnalytics: false });
    expect(inviato.length, 'il dato è partito lo stesso').toBe(0);
  });

  it('manda l evento al raccoglitore, con importo e negozio veri', async () => {
    const { contaAcquisto } = await import('@/lib/analytics/server');
    await contaAcquisto(acquisto);

    expect(inviato.length).toBe(1);
    expect(inviato[0].url).toBe('https://eu.i.posthog.com/capture/');
    expect(inviato[0].corpo.event).toBe('order_placed');
    expect(inviato[0].corpo.distinct_id).toBe('cliente-1');
    const props = inviato[0].corpo.properties as Record<string, unknown>;
    expect(props.total_cents).toBe(3400);
    expect(props.seller_id).toBe('negozio-1');
    expect(props.checkout_id).toBe('carrello-9');
  });

  it('usa la stessa chiave del browser, così il doppio invio non gonfia i conti', async () => {
    const { contaAcquisto } = await import('@/lib/analytics/server');
    await contaAcquisto(acquisto);
    const props = inviato[0].corpo.properties as Record<string, unknown>;
    // È la stessa che scrive lib/analytics/events.ts dal browser.
    expect(props.$insert_id).toBe(`order_placed:${acquisto.orderId}`);
  });

  it('senza chiave configurata non chiama nessuno e non si lamenta', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    vi.resetModules();
    const { contaAcquisto, misuraAttiva } = await import('@/lib/analytics/server');
    expect(misuraAttiva()).toBe(false);
    await contaAcquisto(acquisto);
    expect(inviato.length).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('se il raccoglitore è giù, l ordine non ne risente: si annota e si va avanti', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rete giù'); }));
    const { contaAcquisto } = await import('@/lib/analytics/server');
    await expect(contaAcquisto(acquisto)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('anche una risposta di errore non fa fallire niente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
    const { contaAcquisto } = await import('@/lib/analytics/server');
    await expect(contaAcquisto(acquisto)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

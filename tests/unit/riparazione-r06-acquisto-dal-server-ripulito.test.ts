/**
 * R06-020 (12/11/2026) — LA MISURA CHE PARTE DAL SERVER ERA UNA SECONDA PORTA SENZA RETE.
 *
 * `contaAcquisto` fa una POST diretta a PostHog dal server, dove `before_send`
 * (un cancello del browser) non c'e'. Oggi partono solo identificativi e
 * importi, ma il giorno che una proprieta' porta un indirizzo con parametri,
 * un'email o un telefono, nessuna rete lo fermava. Qui le varianti
 * dell'esperimento (l'unico pezzo libero dell'evento) portano dati personali.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  POSTHOG_ACCESO: true,
}));

const inviato: Array<Record<string, unknown>> = [];
beforeEach(() => {
  inviato.length = 0;
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_finta');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('posthog')) inviato.push(JSON.parse(String(init?.body ?? '{}')));
    return new Response('{"status":1}', { status: 200 });
  }));
  vi.resetModules();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('R06-020 · l\'acquisto dal server passa dalla rete dei dati personali', () => {
  it('indirizzi con parametri, email e telefoni non partono in chiaro; identificativi e importi si', async () => {
    const { contaAcquisto } = await import('@/lib/analytics/server');
    await contaAcquisto({
      orderId: '11111111-1111-1111-1111-111111111111',
      buyerId: 'cliente-1',
      totalCents: 3400,
      paymentMethod: 'card',
      sellerId: 'negozio-1',
      checkoutId: 'carrello-9',
      consensoAnalytics: true,
      varianti: {
        provenienza: 'https://mycity.it/search?q=mario.rossi@gmail.com',
        nota: 'richiamare 333 123 4567',
      },
    });
    expect(inviato.length).toBe(1);
    const testo = JSON.stringify(inviato[0]);
    expect(testo, 'Dal server l\'email e\' partita in chiaro verso PostHog').not.toContain('mario.rossi');
    expect(testo).not.toContain('333 123 4567');
    const p = inviato[0].properties as Record<string, unknown>;
    expect(p.order_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(p.total_cents).toBe(3400);
    expect(p.seller_id).toBe('negozio-1');
    expect(p.$insert_id).toBe('order_placed:11111111-1111-1111-1111-111111111111');
  });
});

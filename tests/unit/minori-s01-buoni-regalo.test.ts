import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S01 — buoni regalo verso Stripe (schede 1844, 108).
 *  · senza Idempotency-Key e con un'email lunga la chiave di riserva restava
 *    sotto i 255 caratteri di Stripe? No: arrivava a 260. Ora no.
 *  · l'email del destinatario non entra in chiaro nella chiave, e il suo nome
 *    non va nella descrizione che finisce sulla ricevuta.
 */
const stato = vi.hoisted(() => ({ create: undefined as unknown as ReturnType<typeof vi.fn> }));

vi.mock('@/lib/funzioni-al-lancio', async (o) => ({ ...((await o()) as object), BUONI_REGALO_IN_VENDITA: true }));
const UTENTE = { id: '11111111-2222-4333-8444-555555555555', email: 'a@b.it', email_confirmed_at: '2026-10-01T10:00:00Z' };
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, g: (c: { user: typeof UTENTE; req: Request }) => unknown) => (req: Request) =>
    g({ user: UTENTE, req }),
}));
vi.mock('@/lib/stripe/client', () => {
  stato.create = vi.fn(async () => ({ id: 'cs', url: 'https://checkout.stripe.com/x' }));
  return { isStripeConfigured: () => true, getStripe: () => ({ checkout: { sessions: { create: stato.create } } }) };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { POST } from '@/app/api/gift-cards/checkout/route';

function richiesta(corpo: unknown, chiave?: string) {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (chiave) h['idempotency-key'] = chiave;
  return new Request('http://localhost/api/gift-cards/checkout', { method: 'POST', headers: h, body: JSON.stringify(corpo) }) as never;
}

const EMAIL_LUNGA = `${'x'.repeat(188)}@esempio.it`; // 199 caratteri, sotto il tetto di 200 dello schema

beforeEach(() => stato.create.mockClear());

describe('buono regalo: la chiave di riserva di Stripe', () => {
  it('con email lunga e senza intestazione resta entro 255 caratteri e non contiene l\'email', async () => {
    const r = await (POST as unknown as (r: unknown) => Promise<Response>)(
      richiesta({ amountEuro: 100, recipientName: 'Maria', recipientEmail: EMAIL_LUNGA }),
    );
    expect(r.status).toBe(200);
    const chiave = (stato.create.mock.calls[0] as unknown[])[1] as { idempotencyKey: string };
    expect(chiave.idempotencyKey.length).toBeLessThanOrEqual(255);
    expect(chiave.idempotencyKey).not.toContain('@');
  });

  it('due tentativi uguali nella stessa finestra danno la stessa chiave', async () => {
    const corpo = { amountEuro: 25, recipientName: 'Maria', recipientEmail: 'maria@esempio.it' };
    await (POST as unknown as (r: unknown) => Promise<Response>)(richiesta(corpo));
    await (POST as unknown as (r: unknown) => Promise<Response>)(richiesta(corpo));
    const [a, b] = stato.create.mock.calls.map((c) => ((c as unknown[])[1] as { idempotencyKey: string }).idempotencyKey);
    expect(a).toBe(b);
  });

  it('il nome del destinatario non sta nella descrizione della riga', async () => {
    await (POST as unknown as (r: unknown) => Promise<Response>)(
      richiesta({ amountEuro: 25, recipientName: 'Giuseppina Verdi', recipientEmail: 'g@esempio.it' }, 'k1'),
    );
    const sessione = (stato.create.mock.calls[0] as unknown[])[0] as {
      line_items: Array<{ price_data: { product_data: { description: string } } }>;
    };
    expect(sessione.line_items[0].price_data.product_data.description).not.toContain('Giuseppina');
  });
});

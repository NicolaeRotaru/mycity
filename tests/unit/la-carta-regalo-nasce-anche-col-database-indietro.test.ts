import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

/**
 * LA CARTA REGALO NASCE ANCHE COL DATABASE INDIETRO.
 *
 * Il webhook segna sulla carta il pagamento che la regge (colonna della
 * migrazione 178). Ma il codice puo' arrivare in produzione prima della
 * migrazione: senza ripiego l'inserimento cade, il pagamento e' incassato e la
 * carta non nasce. Col ripiego nasce lo stesso, senza quella colonna, e lo si
 * dice nei log. Un'altra colonna mancante resta un errore vero: niente
 * riscritture alla cieca.
 */

const stato: {
  inseriti: Record<string, unknown>[];
  manca: string | null;
  formato: 'postgrest' | 'postgres';
} = { inseriti: [], manca: null, formato: 'postgrest' };

const erroreColonna = (colonna: string) =>
  stato.formato === 'postgrest'
    ? { code: 'PGRST204', message: `Could not find the '${colonna}' column of 'gift_cards' in the schema cache`, details: null }
    : { code: '42703', message: `column "${colonna}" of relation "gift_cards" does not exist`, details: null };

const { sendEmail, logError } = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ ok: true })), logError: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: logError, warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: new Proxy({}, { get: () => () => 'segreto-di-prova' }) }));
vi.mock('@/lib/email/client', () => ({ sendEmail }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      insert: (riga: Record<string, unknown>) => {
        if (stato.manca && stato.manca in riga) return Promise.resolve({ error: erroreColonna(stato.manca) });
        stato.inseriti.push(riga);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

const { handleGiftCardPurchase } = await import('@/lib/stripe/webhook/giftcard');

const sessione = {
  id: 'cs_indietro',
  payment_intent: 'pi_indietro',
  metadata: { kind: 'gift_card', amount_cents: '5000', recipient_email: 'chi-riceve@example.com' },
  customer_details: null,
  customer_email: null,
} as unknown as Stripe.Checkout.Session;

beforeEach(() => {
  stato.inseriti = [];
  stato.manca = null;
  stato.formato = 'postgrest';
  sendEmail.mockClear();
  logError.mockClear();
});

describe('la carta regalo nasce anche col database indietro', () => {
  it('col database aggiornato la carta nasce col pagamento segnato', async () => {
    await handleGiftCardPurchase(sessione);
    expect(stato.inseriti).toHaveLength(1);
    expect(stato.inseriti[0]).toMatchObject({ stripe_session_id: 'cs_indietro', stripe_payment_intent: 'pi_indietro', balance_cents: 5000 });
  });

  for (const formato of ['postgrest', 'postgres'] as const) {
    it(`senza la colonna del pagamento la carta nasce lo stesso, e lo si dice (${formato})`, async () => {
      stato.manca = 'stripe_payment_intent';
      stato.formato = formato;
      await expect(handleGiftCardPurchase(sessione)).resolves.toBeUndefined();
      expect(stato.inseriti).toHaveLength(1);
      expect(stato.inseriti[0]).toMatchObject({ code: expect.stringMatching(/^MC-/), stripe_session_id: 'cs_indietro', amount_cents: 5000, balance_cents: 5000 });
      expect(stato.inseriti[0]).not.toHaveProperty('stripe_payment_intent');
      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'chi-riceve@example.com' }));
      expect(logError).toHaveBeenCalledWith(expect.stringMatching(/senza il pagamento/), expect.anything());
    });
  }

  it("un'altra colonna mancante resta un errore: l'evento torna da rifare", async () => {
    stato.manca = 'recipient_email';
    await expect(handleGiftCardPurchase(sessione)).rejects.toThrow(/non creata/);
    expect(stato.inseriti).toHaveLength(0);
  });
});

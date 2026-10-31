import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

/**
 * LA CARTA REGALO SEGUE IL PAGAMENTO CHE LA COMPRA.
 *
 * La migrazione 178 insegna al database a spegnere un buono regalo quando il
 * suo pagamento torna indietro (`gift_card_void_for_payment`). Ma il database
 * da solo non sa quando succede: lo sa il webhook di Stripe. Servono tre fili:
 *  ① alla nascita il buono si segna il pagamento (payment_intent) che lo regge,
 *    perche' rimborso e contestazione arrivano col pagamento, non con la sessione;
 *  ② un rimborso pieno di un pagamento senza ordini chiede l'annullo;
 *  ③ una contestazione in banca di un pagamento senza ordini chiede l'annullo.
 * E un errore del database non si ingoia: l'evento torna da rifare.
 */

type Chiamata = { nome: string; argomenti: Record<string, unknown> };
const stato: {
  inseriti: Record<string, unknown>[];
  chiamate: Chiamata[];
  erroreRpc: { message: string } | null;
} = { inseriti: [], chiamate: [], erroreRpc: null };

// Ogni lettura sugli ordini risponde «nessun ordine»: e' il pagamento di un buono.
const nessunOrdine = { data: [], error: null };
const catena = (): unknown =>
  new Proxy(() => {}, {
    get: (_t, chiave) =>
      chiave === 'then'
        ? (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(nessunOrdine).then(ok, ko)
        : () => catena(),
  });

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: new Proxy({}, { get: () => () => 'segreto-di-prova' }) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => ({}) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) =>
      tabella === 'gift_cards'
        ? {
            insert: (riga: Record<string, unknown>) => {
              stato.inseriti.push(riga);
              return Promise.resolve({ error: null });
            },
          }
        : catena(),
    rpc: (nome: string, argomenti: Record<string, unknown>) => {
      stato.chiamate.push({ nome, argomenti });
      return Promise.resolve(
        stato.erroreRpc
          ? { data: null, error: stato.erroreRpc }
          : { data: { esito: 'annullato', code: 'MC-PROVA', non_recuperati_cents: 0 }, error: null },
      );
    },
  }),
}));

const { handleGiftCardPurchase } = await import('@/lib/stripe/webhook/giftcard');
const { handleChargeRefunded } = await import('@/lib/stripe/webhook/rimborsi');
const { handleDisputeCreated } = await import('@/lib/stripe/webhook/dispute');

const annulli = () => stato.chiamate.filter((c) => c.nome === 'gift_card_void_for_payment');

beforeEach(() => {
  stato.inseriti = [];
  stato.chiamate = [];
  stato.erroreRpc = null;
});

describe('la carta regalo segue il pagamento che la compra', () => {
  it('alla nascita la carta si segna il pagamento che la regge', async () => {
    await handleGiftCardPurchase({
      id: 'cs_carta',
      payment_intent: 'pi_carta',
      metadata: { kind: 'gift_card', amount_cents: '5000' },
      customer_details: null,
      customer_email: null,
    } as unknown as Stripe.Checkout.Session);
    expect(stato.inseriti).toHaveLength(1);
    expect(stato.inseriti[0]).toMatchObject({ stripe_session_id: 'cs_carta', stripe_payment_intent: 'pi_carta' });
  });

  it('il pagamento rimborsato per intero spegne la carta', async () => {
    await handleChargeRefunded({ payment_intent: 'pi_carta', refunded: true, amount: 5000, amount_refunded: 5000 } as unknown as Stripe.Charge);
    expect(annulli()).toEqual([
      { nome: 'gift_card_void_for_payment', argomenti: { p_session_id: null, p_payment_intent: 'pi_carta', p_reason: 'refunded' } },
    ]);
  });

  it('un rimborso parziale non spegne la carta a indovinare', async () => {
    await handleChargeRefunded({ payment_intent: 'pi_carta', refunded: false, amount: 5000, amount_refunded: 1000 } as unknown as Stripe.Charge);
    expect(annulli()).toEqual([]);
  });

  it('il pagamento contestato in banca spegne la carta', async () => {
    await handleDisputeCreated({ id: 'dp_carta', payment_intent: 'pi_carta', charge: 'ch_carta', amount: 5000 } as unknown as Stripe.Dispute);
    expect(annulli()).toEqual([
      { nome: 'gift_card_void_for_payment', argomenti: { p_session_id: null, p_payment_intent: 'pi_carta', p_reason: 'disputed' } },
    ]);
  });

  it("se il database non risponde l'evento torna da rifare, non si chiude", async () => {
    stato.erroreRpc = { message: 'timeout' };
    await expect(
      handleChargeRefunded({ payment_intent: 'pi_carta', refunded: true, amount: 5000, amount_refunded: 5000 } as unknown as Stripe.Charge),
    ).rejects.toThrow(/non annullato/);
    await expect(
      handleDisputeCreated({ id: 'dp_carta', payment_intent: 'pi_carta', charge: 'ch_carta', amount: 5000 } as unknown as Stripe.Dispute),
    ).rejects.toThrow(/non annullato/);
  });
});

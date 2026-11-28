import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import { fintoDatabase, type FintoDatabase } from './aiuti/finto-database-dei-pagamenti';

/**
 * R28-016 — Una sponsorizzazione rimborsata o contestata in banca restava attiva.
 *
 * Il pagamento di una sponsorizzazione non ha ordini: il rimborso pieno e la contestazione passavano
 * dai rami «senza ordini» dei gestori, che guardavano solo i buoni regalo. La vetrina restava «In
 * primo piano» fino all'ultimo giorno coi soldi tornati al negozio o ripresi dalla banca.
 *
 * Qui girano i gestori VERI, su un database finto che applica i filtri come PostgREST. Stripe è
 * finto: ritrova la sessione di cassa dal pagamento, come fa quello vero.
 */

const stato: { db: FintoDatabase } = { db: fintoDatabase() };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    // R05-010 (onda 2) — senza ordini la contestazione guarda prima il carrello del pagamento: qui non è di un carrello.
    paymentIntents: { retrieve: async (id: string) => ({ id, metadata: {}, transfer_group: null }) },
    checkout: {
      sessions: {
        list: async (p: { payment_intent?: string }) => ({ data: p.payment_intent === 'pi_vetrina' ? [{ id: 'cs_vetrina' }] : [] }),
      },
    },
  }),
}));

import { handleChargeRefunded } from '@/lib/stripe/webhook/rimborsi';
import { handleDisputeCreated } from '@/lib/stripe/webhook/dispute';

const vetrina = () => stato.db.tabelle.sponsored_listings!.find((r) => r.id === 'sp1')!;
const avvisi = () => stato.db.tabelle.notifications!.filter((n) => String(n.title).includes('Sponsorizzazione in pausa'));

const rimborso = (pagamento: string, rimborsati: number) =>
  ({ id: 'ch_1', payment_intent: pagamento, amount: 2000, amount_refunded: rimborsati, refunded: rimborsati >= 2000 }) as unknown as Stripe.Charge;
const contestazione = (status: string, pagamento = 'pi_vetrina') =>
  ({ id: 'dp_1', payment_intent: pagamento, charge: 'ch_1', amount: 2000, status, reason: 'fraudulent' }) as unknown as Stripe.Dispute;

beforeEach(() => {
  stato.db = fintoDatabase({
    orders: [],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
    sponsored_listings: [{
      id: 'sp1', seller_id: 'negozio1', product_id: 'p1', placement: 'search_top', status: 'active',
      start_date: '2026-11-16', end_date: '2026-11-29', stripe_session_id: 'cs_vetrina',
    }],
  });
  // Nessun buono regalo con questo pagamento: il database lo dice così (178).
  stato.db.rispostaRpc = () => ({ data: { esito: 'non_trovato' }, error: null });
});

describe('R28-016 · la sponsorizzazione segue il suo pagamento', () => {
  it('IL CASO DELLA VOCE — rimborsata per intero, la sponsorizzazione si chiude', async () => {
    await handleChargeRefunded(rimborso('pi_vetrina', 2000));
    expect(vetrina().status).toBe('ended');
  });

  it('lo stesso rimborso consegnato due volte la chiude una volta, senza errori', async () => {
    await handleChargeRefunded(rimborso('pi_vetrina', 2000));
    await handleChargeRefunded(rimborso('pi_vetrina', 2000));
    expect(vetrina().status).toBe('ended');
    expect(stato.db.scritture.filter((s) => s.tabella === 'sponsored_listings' && s.righe > 0)).toHaveLength(1);
  });

  it('un rimborso parziale non la spegne a indovinare', async () => {
    await handleChargeRefunded(rimborso('pi_vetrina', 500));
    expect(vetrina().status).toBe('active');
  });

  it('IL CASO DELLA VOCE — contestata in banca, va in pausa e gli amministratori sanno che va riaccesa se vinta', async () => {
    await handleDisputeCreated(contestazione('needs_response'));
    expect(vetrina().status).toBe('paused');
    expect(avvisi()).toHaveLength(1);
    expect(String(avvisi()[0].body)).toMatch(/riaccesa a mano/);
  });

  it('una richiesta di informazioni della banca non la spegne', async () => {
    await handleDisputeCreated(contestazione('warning_needs_response'));
    expect(vetrina().status).toBe('active');
  });

  it('il rimborso di un altro pagamento non tocca la sponsorizzazione', async () => {
    await handleChargeRefunded(rimborso('pi_altro', 2000));
    await handleDisputeCreated(contestazione('needs_response', 'pi_altro'));
    expect(vetrina().status).toBe('active');
  });
});

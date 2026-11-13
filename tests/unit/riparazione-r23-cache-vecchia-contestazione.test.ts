import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * R23-003 — La memoria dello schema di PostgREST vecchia, nel ripiego fatto a mano della
 * contestazione vinta.
 *
 * Alla vittoria il bonifico al negozio torna in coda col numero del tentativo che sale di uno:
 * è quel numero a cambiare la chiave anti-doppione del bonifico. Il ripiego toglie le colonne
 * nuove una migrazione alla volta, e riconosceva «colonna che manca» da PGRST204 senza chiedere
 * al database. Con la 124 applicata e la memoria di PostgREST vecchia, PGRST204 su
 * `payout_tentativo` toglieva il tentativo: il bonifico tornava in coda con la chiave del
 * bonifico già stornato, e Stripe avrebbe restituito quello. Il negozio vinceva e non veniva pagato.
 *
 * Qui il database finto non ha la 126 (`dispute_seller_reversed_cents` manca davvero: quel
 * ripiego è giusto), ha la 124, e PostgREST ha la memoria vecchia: rifiuta `payout_tentativo`.
 */

const stato: { db: FintoDatabase } = { db: fintoDatabase() };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
// Il client admin con cui si chiede al database se la colonna c'è: lo stesso database finto.
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => stato.db.client.from(t) }) }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    transfers: {
      listReversals: async () => ({ data: [] }),
      createReversal: async (_t: string, p: { amount: number }) => ({ id: 'trr_nuovo', amount: p.amount }),
    },
  }),
  isStripeConfigured: () => true,
}));

import { handleDisputeClosed, handleDisputeCreated } from '@/lib/stripe/webhook/dispute';

function ordineStornato(extra: Riga = {}): Riga {
  return {
    id: 'o1',
    seller_id: 's1',
    total_price: 27.9,
    gross_total_cents: 2790,
    payment_status: 'PAID',
    refunded_amount_cents: 0,
    wallet_applied_cents: 0,
    delivery_status: 'DELIVERED',
    payout_status: 'REVERSED',
    dispute_status: 'OPEN',
    stripe_payment_intent: 'pi_1',
    stripe_charge_id: 'ch_1',
    stripe_transfer_group: null,
    stripe_transfer_id: 'tr_1',
    stripe_reversal_id: 'trr_1',
    seller_payout_cents: 1800,
    seller_payout_reversed_cents: 1800,
    payout_tentativo: 0,
    rider_id: null,
    rider_transfer_id: null,
    rider_payout_status: null,
    rider_payout_reversed_cents: 0,
    rider_payout_tentativo: 0,
    rider_fee_cents: null,
    shipping_cost: 0,
    ...extra,
  };
}

const ordine = () => stato.db.tabelle.orders.find((r) => r.id === 'o1')!;
const vinta = { id: 'dp_1', status: 'won', amount: 2790, payment_intent: 'pi_1', charge: 'ch_1', created: 1_900_000_000 };

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'chiave-di-servizio');
  stato.db = fintoDatabase({ orders: [ordineStornato()], profiles: [{ id: 'admin1', role: 'admin' }], notifications: [] });
  // La 126 non c'è: le sue colonne mancano davvero.
  stato.db.colonneMancanti.orders = ['dispute_seller_reversed_cents', 'dispute_rider_reversed_cents'];
  // La 124 c'è, ma PostgREST ha la memoria di prima: una scrittura col tentativo la rifiuta lui.
  stato.db.guasto = (s) =>
    s.tabella === 'orders' && s.operazione === 'update' && s.valori && !Array.isArray(s.valori) && 'payout_tentativo' in s.valori
      ? { code: 'PGRST204', message: "Could not find the 'payout_tentativo' column of 'orders' in the schema cache" }
      : null;
});

describe('R23-003 — la contestazione vinta non toglie il tentativo del bonifico per una memoria vecchia', () => {
  it('memoria di PostgREST vecchia su payout_tentativo: il bonifico non torna in coda con la chiave vecchia', async () => {
    await expect(handleDisputeClosed(vinta as never), 'la scrittura senza tentativo è riuscita').rejects.toThrow();

    expect(ordine(), 'in coda col tentativo vecchio: Stripe restituirebbe il bonifico già stornato').toMatchObject({
      payout_status: 'REVERSED',
      payout_tentativo: 0,
    });
    const rimessiInCoda = stato.db.scritture.filter(
      (s) => s.tabella === 'orders' && s.operazione === 'update' && (s.valori as Riga | null)?.payout_status === 'HELD',
    );
    expect(rimessiInCoda).toEqual([]);
  });

  it('a schema ricaricato il bonifico torna in coda col tentativo nuovo, senza la colonna della 126', async () => {
    stato.db.guasto = () => null;
    await handleDisputeClosed(vinta as never);
    expect(ordine()).toMatchObject({ payout_status: 'HELD', payout_tentativo: 1, stripe_transfer_id: null });
  });

  it('alla contestazione aperta, il promemoria rifiutato da una memoria vecchia (126 applicata) arriva agli amministratori', async () => {
    stato.db.tabelle.orders = [ordineStornato({ payout_status: 'TRANSFERRED', dispute_status: null, seller_payout_reversed_cents: 0, stripe_reversal_id: null })];
    stato.db.colonneMancanti.orders = [];
    stato.db.guasto = (s) =>
      s.tabella === 'orders' && s.operazione === 'update' && s.valori && !Array.isArray(s.valori) && 'dispute_seller_reversed_cents' in s.valori
        ? { code: 'PGRST204', message: "Could not find the 'dispute_seller_reversed_cents' column of 'orders' in the schema cache" }
        : null;

    await handleDisputeCreated({ ...vinta, status: 'needs_response' } as never);

    expect(ordine()).toMatchObject({ payout_status: 'REVERSED', seller_payout_reversed_cents: 1800 });
    const avvisi = stato.db.tabelle.notifications.filter((n) => n.title === '⚠️ Storno al negozio da controllare');
    expect(avvisi, 'il promemoria è perso e nessuno sa quanto restituire se si vince').toHaveLength(1);
    expect(String(avvisi[0]!.body)).toMatch(/18,00\s€.*promemoria non è stato scritto/);
  });
});

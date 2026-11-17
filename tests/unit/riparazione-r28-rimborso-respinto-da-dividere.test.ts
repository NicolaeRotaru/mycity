import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * R28-014 — Se la banca respinge un rimborso dal cruscotto che aspetta ancora la divisione, il sito lo
 * toglieva dagli ordini che non l'avevano mai registrato.
 *
 * Carrello di due negozi sullo stesso pagamento: il pane (20 €) e i fiori (30 €). Il sito ha già reso
 * 4 € sul pane (`re_sito`, scritto nel suo elenco, quota del negozio tolta sulla carta). Poi dal
 * cruscotto escono 5 € (`re_cruscotto`): Stripe non dice di quale negozio sono, i bonifici si fermano
 * con la pausa e il rimborso aspetta la divisione, scritto su nessun ordine. La banca lo respinge.
 *
 * Prima: i 5 € si dividevano fra gli ordini in proporzione a quanto risultava rimborsato, cioè tutti
 * sul pane, che tornava «pagato» con 0 € rimborsati (i 4 € del sito spariti) e al negozio del pane
 * tornava nel bonifico la quota di un rimborso che il cliente ha avuto davvero.
 *
 * Qui gira il gestore VERO dell'avviso, su un database finto che applica i filtri come PostgREST.
 */

const stato: { db: FintoDatabase } = { db: fintoDatabase() };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
// Stripe è sempre finto: questo avviso non chiede niente a Stripe, e se lo facesse la prova cadrebbe.
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => { throw new Error('Stripe non va chiamato per un rimborso respinto'); },
  isStripeConfigured: () => true,
}));

import { handleRefundUpdated } from '@/lib/stripe/webhook/rimborsi';

const PAUSA = 'RIMBORSO_DA_RIPARTIRE';

function ordine(extra: Riga): Riga {
  return {
    payment_status: 'PAID',
    payout_status: 'HELD',
    stripe_payment_intent: 'pi_1',
    stripe_transfer_id: null,
    stripe_reversal_id: null,
    seller_payout_reversed_cents: 0,
    payout_tentativo: 0,
    refunded_amount_cents: 0,
    stripe_refund_id: null,
    internal_dispute_status: PAUSA,
    ...extra,
  };
}

const pane = () => ordine({
  id: 'pane', total_price: 20, gross_total_cents: 2000, seller_payout_cents: 1600,
  refunded_amount_cents: 400, payment_status: 'PARTIALLY_REFUNDED', seller_payout_reversed_cents: 320, stripe_refund_id: 're_sito',
});
const fiori = () => ordine({ id: 'fiori', total_price: 30, gross_total_cents: 3000, seller_payout_cents: 2400 });

const respinto = (id: string, centesimi: number, metadata: Record<string, string> = {}) =>
  ({ id, amount: centesimi, status: 'failed', payment_intent: 'pi_1', metadata }) as unknown as Parameters<typeof handleRefundUpdated>[0];

const riga = (id: string) => stato.db.tabelle.orders!.find((r) => r.id === id)!;
const avvisi = () => stato.db.tabelle.notifications!.filter((n) => n.title === '⚠️ Rimborso rifiutato dalla banca');

beforeEach(() => {
  stato.db = fintoDatabase({ orders: [], profiles: [{ id: 'admin1', role: 'admin' }], notifications: [] });
});

describe('R28-014 · il rimborso dal cruscotto respinto mentre aspetta la divisione', () => {
  it('IL CASO DELLA VOCE — non si toglie dagli ordini che non l’hanno mai registrato', async () => {
    stato.db.tabelle.orders = [pane(), fiori()];
    await handleRefundUpdated(respinto('re_cruscotto', 500));

    expect(riga('pane'), 'i 4 € resi dal sito al cliente sono arrivati davvero: restano').toMatchObject({
      refunded_amount_cents: 400, payment_status: 'PARTIALLY_REFUNDED', seller_payout_reversed_cents: 320, stripe_refund_id: 're_sito',
    });
    expect(riga('fiori')).toMatchObject({ refunded_amount_cents: 0, payment_status: 'PAID', seller_payout_reversed_cents: 0 });
    expect(stato.db.scritture.filter((s) => s.tabella === 'orders'), 'nessuna scrittura sugli ordini').toEqual([]);
    // Gli amministratori lo sanno lo stesso, una volta: il cliente i 5 € non li ha avuti.
    expect(avvisi()).toHaveLength(1);
    expect(String(avvisi()[0].body)).toMatch(/Non era ancora scritto su nessun ordine/);
    expect(String(avvisi()[0].body)).not.toMatch(/era già stato registrato/);
  });

  it('il rimborso dal cruscotto già diviso (scritto nell’elenco di un ordine) si toglie solo da quello', async () => {
    stato.db.tabelle.orders = [
      pane(),
      ordine({
        id: 'fiori', total_price: 30, gross_total_cents: 3000, seller_payout_cents: 2400,
        refunded_amount_cents: 500, payment_status: 'PARTIALLY_REFUNDED', seller_payout_reversed_cents: 400, stripe_refund_id: 're_diviso',
      }),
    ];
    await handleRefundUpdated(respinto('re_diviso', 500));

    expect(riga('pane'), 'il pane questo rimborso non l’ha mai avuto').toMatchObject({ refunded_amount_cents: 400, seller_payout_reversed_cents: 320 });
    expect(riga('fiori')).toMatchObject({ refunded_amount_cents: 0, payment_status: 'PAID', seller_payout_reversed_cents: 0 });
    expect(String(riga('fiori').stripe_refund_id)).toContain('respinto:500:re_diviso');
  });

  it('senza la pausa della divisione il conto resta quello di prima (un ordine solo, rimborso scritto senza elenco)', async () => {
    stato.db.tabelle.orders = [ordine({
      id: 'solo', total_price: 20, gross_total_cents: 2000, seller_payout_cents: 1600, internal_dispute_status: null,
      refunded_amount_cents: 300, payment_status: 'PARTIALLY_REFUNDED', payout_status: 'PROCESSING', seller_payout_reversed_cents: 240,
    })];
    await handleRefundUpdated(respinto('re_x', 300));
    expect(riga('solo')).toMatchObject({ refunded_amount_cents: 0, payment_status: 'PAID', seller_payout_reversed_cents: 240 });
  });

  it('il rimborso nostro, con l’etichetta dell’ordine, non passa dal filtro della divisione', async () => {
    stato.db.tabelle.orders = [ordine({
      id: 'pane', total_price: 20, gross_total_cents: 2000, seller_payout_cents: 1600,
      refunded_amount_cents: 400, payment_status: 'PARTIALLY_REFUNDED', seller_payout_reversed_cents: 320, stripe_refund_id: null,
    })];
    await handleRefundUpdated(respinto('re_nostro', 400, { order_id: 'pane' }));
    expect(riga('pane')).toMatchObject({ refunded_amount_cents: 0, payment_status: 'PAID', seller_payout_reversed_cents: 0 });
  });
});

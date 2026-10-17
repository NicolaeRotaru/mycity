import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, TIMEOUT, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 16/10/2026 — IL CARRELLO CHE NON QUADRA RIMBORSAVA IL CLIENTE, MA LA MERCE
 * TENUTA DA PARTE NON TORNAVA PIÙ IN VENDITA.
 *
 * Al checkout con carta la merce si toglie dalla vendita (`reserve_stock`) e il
 * codice sconto si consuma subito. Se Stripe incassa una cifra diversa dal
 * preventivo, il webhook rimborsa il cliente e chiude il carrello. Lo chiudeva
 * e basta: niente `restore_stock`, niente `release_coupon`. E nessun giro lo
 * riprendeva, perché il giro dei carrelli scaduti lavora solo quelli «in
 * attesa». Il fornaio ha un pezzo solo: quel pezzo risultava esaurito per
 * sempre, e il cliente rimborsato perdeva il suo codice sconto.
 *
 * La prova fa girare il gestore VERO del pagamento completato contro un
 * database finto, nelle due forme che il database ha oggi: con la migrazione
 * 126 (stato 'MISMATCH') e senza (il vincolo vecchio lo rifiuta, si ripiega su
 * 'CANCELED').
 */

const stato: { db: FintoDatabase; rimborsi: string[] } = { db: fintoDatabase(), rimborsi: [] };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/analytics/server', () => ({ contaAcquisto: vi.fn(async () => {}), analyticsConsentita: vi.fn(async () => false) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    refunds: {
      create: async (_p: unknown, o: { idempotencyKey: string }) => {
        if (!stato.rimborsi.includes(o.idempotencyKey)) stato.rimborsi.push(o.idempotencyKey);
        return { id: `re_${o.idempotencyKey}` };
      },
    },
  }),
  isStripeConfigured: () => true,
  computeOrderSplit: () => ({ subtotalCents: 0, applicationFeeCents: 0, sellerPayoutCents: 0 }),
}));

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';
import { merceDelCarrello } from '@/lib/stripe/webhook/quadratura';

/** L'errore vero di PostgreSQL sul vincolo di prima della 126. */
const VINCOLO_VECCHIO = {
  code: '23514',
  message: 'new row for relation "pending_checkouts" violates check constraint "pending_checkouts_status_check"',
};

/** Il preventivo era 20,00 €, Stripe ne ha incassati 15,00. */
const sessione = {
  id: 'cs_1', payment_status: 'paid', client_reference_id: 'pc_1', payment_intent: 'pi_1', amount_total: 1500, metadata: {},
} as unknown as Parameters<typeof handleCheckoutCompleted>[0];

function carrello(extra: Riga = {}): Riga {
  return {
    id: 'pc_1', buyer_id: 'u1', status: 'PENDING', coupon_code: 'BENVENUTO', pickup_in_store: false, total_cents: 2000,
    stripe_session_id: 'cs_1', expires_at: '2999-01-01T00:00:00Z', delivery: {},
    groups: [{
      sellerId: 'fornaio', storeName: 'Il fornaio',
      items: [
        { productId: 'p_pagnotta', variantId: null, quantity: 1, name: 'Pagnotta', unitAmountCents: 1200 },
        { productId: 'p_focaccia', variantId: 'v_grande', quantity: 2, name: 'Focaccia', unitAmountCents: 400 },
      ],
    }],
    ...extra,
  };
}

const chiamate = (nome: string) => stato.db.rpc.filter((r) => r.nome === nome).map((r) => r.argomenti);

beforeEach(() => {
  stato.rimborsi = [];
  stato.db = fintoDatabase({
    pending_checkouts: [carrello()],
    orders: [],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
  });
});

describe('il carrello che non quadra col preventivo', () => {
  it('IL CASO DELLA SCHEDA — con la 126: carrello MISMATCH, la merce torna in vendita e il codice al cliente', async () => {
    await handleCheckoutCompleted(sessione);

    expect(stato.db.tabelle.pending_checkouts![0].status).toBe('MISMATCH');
    expect(stato.rimborsi).toEqual(['refund_quadratura_pc_1']);
    expect(chiamate('restore_stock'), 'la merce tenuta da parte resta fuori vendita per sempre').toEqual([{
      p_items: [
        { product_id: 'p_pagnotta', variant_id: null, qty: 1 },
        { product_id: 'p_focaccia', variant_id: 'v_grande', qty: 2 },
      ],
    }]);
    expect(chiamate('release_coupon'), 'il cliente rimborsato perde il suo codice sconto').toEqual([{ p_code: 'BENVENUTO' }]);
  });

  it('senza la 126, com è la produzione oggi: carrello CANCELED, e la merce torna lo stesso', async () => {
    stato.db.guasto = (s) =>
      s.tabella === 'pending_checkouts' && (s.valori as Riga | null)?.status === 'MISMATCH' ? VINCOLO_VECCHIO : null;

    await handleCheckoutCompleted(sessione);

    expect(stato.db.tabelle.pending_checkouts![0].status).toBe('CANCELED');
    expect(chiamate('restore_stock')).toHaveLength(1);
    expect(chiamate('release_coupon')).toEqual([{ p_code: 'BENVENUTO' }]);
  });

  it('lo stesso avviso consegnato due volte rimette la merce una volta sola', async () => {
    await handleCheckoutCompleted(sessione);
    await handleCheckoutCompleted(sessione);

    expect(chiamate('restore_stock'), 'merce rimessa due volte: il negozio vende pezzi che non ha').toHaveLength(1);
    expect(chiamate('release_coupon')).toHaveLength(1);
  });

  it('se il giro dei carrelli scaduti lo prende un attimo prima, non si rimette niente una seconda volta', async () => {
    // Il gestore ha letto il carrello «in attesa»; prima che lo chiuda, il giro
    // dei carrelli scaduti lo prende lui (e rimette lui merce e codice).
    stato.db.guasto = (s) => {
      if (s.tabella === 'pending_checkouts' && s.operazione === 'update') stato.db.tabelle.pending_checkouts![0].status = 'EXPIRED';
      return null;
    };

    await handleCheckoutCompleted(sessione);

    expect(stato.db.tabelle.pending_checkouts![0].status).toBe('EXPIRED');

    expect(chiamate('restore_stock')).toEqual([]);
    expect(chiamate('release_coupon')).toEqual([]);
  });

  it('se il carrello non si riesce a chiudere, non si tocca la merce: la rimette il giro alla scadenza', async () => {
    stato.db.guasto = (s) => (s.tabella === 'pending_checkouts' ? TIMEOUT : null);

    await handleCheckoutCompleted(sessione);

    expect(stato.db.tabelle.pending_checkouts![0].status).toBe('PENDING');
    expect(chiamate('restore_stock')).toEqual([]);
  });

  it('se la merce non torna in vendita, gli amministratori lo sanno', async () => {
    stato.db.rispostaRpc = (nome) =>
      nome === 'restore_stock' ? { data: null, error: { message: 'timeout' } } : { data: null, error: null };

    await handleCheckoutCompleted(sessione);

    const titoli = stato.db.tabelle.notifications!.map((n) => n.title);
    expect(titoli).toContain('⚠️ Merce non rimessa in vendita');
  });
});

describe('la merce di un carrello, da sola', () => {
  it('prende ogni pezzo di ogni negozio, con la sua variante', () => {
    expect(merceDelCarrello([
      { items: [{ productId: 'a', quantity: 1 }] },
      { items: [{ productId: 'b', variantId: 'v', quantity: 3 }] },
    ])).toEqual([
      { product_id: 'a', variant_id: null, qty: 1 },
      { product_id: 'b', variant_id: 'v', qty: 3 },
    ]);
  });
  it('un carrello senza righe leggibili non rimette niente', () => {
    expect(merceDelCarrello(null)).toEqual([]);
    expect(merceDelCarrello([{ items: null }])).toEqual([]);
  });
});

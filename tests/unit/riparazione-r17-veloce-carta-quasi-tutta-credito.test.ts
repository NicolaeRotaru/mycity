import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';
import { creaLibro, creaStripe, type Libro, type StripeFinto } from './aiuti/libro-dei-rimborsi-r17';

/**
 * R17-010 — La veloce pagata tutta o quasi col credito su un ordine con la carta.
 *
 * Maria ordina con la veloce alle 18:05: pane 15 € più 4 € di consegna, 19 €. Paga 18,40 € col
 * credito MyCity e 0,60 € con la carta. Il forno non conferma in 10 minuti. Prima il freno chiedeva
 * a refundOrder 1 € sulla carta, senza guardare quanto ne era stato addebitato: Stripe rifiuta un
 * rimborso più grande dell'addebito (1 € > 0,60 €), il rimborso cadeva, Maria leggeva «te lo
 * rendiamo a mano» e gli amministratori dovevano renderlo. Adesso l'euro torna sul credito, in
 * automatico, una volta sola, e il conto dell'ordine lo dice.
 */

const stato: { libro: Libro; stripe: StripeFinto; avvisi: string[]; crediti: Array<Record<string, unknown>>; creditoCade: boolean } = {
  libro: creaLibro({}),
  stripe: creaStripe(),
  avvisi: [],
  crediti: [],
  creditoCade: false,
};

/** Stripe vero: un rimborso più grande di quanto resta dell'addebito sulla carta lo rifiuta. */
function stripeConLAddebito() {
  const c = stato.stripe.client() as { refunds: { create: (p: { amount: number; payment_intent?: string }, o: unknown) => Promise<unknown> } };
  const crea = c.refunds.create;
  c.refunds.create = async (p, o) => {
    const ordine = stato.libro.db.tabelle.orders!.find((r) => r.stripe_payment_intent === p.payment_intent);
    const addebitato = Math.round(Number(ordine?.total_price ?? 0) * 100);
    if (p.amount > addebitato) {
      throw new Error(`Refund amount (${p.amount}) is greater than unrefunded amount on charge (${addebitato})`);
    }
    return crea(p, o);
  };
  return c;
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.libro.client }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => stripeConLAddebito() }));
vi.mock('@/lib/stripe/webhook/comune', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  notifyAdmins: vi.fn(async (titolo: string, testo: string) => {
    stato.avvisi.push(`${titolo} — ${testo}`);
    return 'mandato';
  }),
}));

import { frenoDellaVeloce } from '@/lib/ordini/veloce-non-confermata';

function ordineVeloce(p: Record<string, unknown> = {}) {
  return {
    id: 'o1', user_id: 'maria', seller_id: 'forno', delivery_status: 'NEW', delivery_slot: ETICHETTA_ADESSO,
    pickup_in_store: false, payment_method: 'card', payment_status: 'PAID', total_price: 0.6, gross_total_cents: 1900,
    wallet_applied_cents: 1840, shipping_cost: 0, delivery_fee_cents: 400, rider_fee_cents: 300, discount_amount: 0,
    stripe_session_id: 'cs_1', stripe_payment_intent: 'pi_1', stripe_refund_id: null, refunded_amount_cents: 0,
    seller_payout_cents: 1350, seller_payout_reversed_cents: 0, payout_status: 'PENDING', rider_id: null,
    stripe_transfer_id: null, internal_dispute_status: null, rider_transfer_id: null, rider_payout_status: null,
    rider_payout_reversed_cents: 0, created_at: '2026-10-30T17:05:00.000Z', ...p,
  };
}

const admin = () => stato.libro.client as unknown as Parameters<typeof frenoDellaVeloce>[0];
const o1 = () => stato.libro.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const campanella = () => (stato.libro.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'maria').map((n) => String(n.body));

async function giro(ora: string) {
  vi.setSystemTime(new Date(ora));
  return frenoDellaVeloce(admin(), new Date(ora));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  stato.stripe = creaStripe();
  stato.avvisi = [];
  stato.crediti = [];
  stato.creditoCade = false;
  stato.libro = creaLibro({
    orders: [ordineVeloce()],
    profiles: [{ id: 'forno', store_hours: null }],
    notifications: [],
  });
  // Il diario del credito: la coppia (motivo, riferimento) è unica, come nel database (098, 143).
  const rpcDelLibro = stato.libro.db.rispostaRpc;
  stato.libro.db.rispostaRpc = (nome, a) => {
    if (nome !== 'wallet_credit') return rpcDelLibro(nome, a);
    if (stato.creditoCade) return { data: null, error: { message: 'timeout del database' } };
    if (stato.crediti.some((m) => m.p_reason === a.p_reason && m.p_ref === a.p_ref)) {
      return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
    }
    stato.crediti.push({ ...a });
    return { data: 1840 + Number(a.p_cents), error: null };
  };
});
afterEach(() => vi.useRealTimers());

describe('R17-010 · la veloce pagata quasi tutta col credito su un ordine con la carta', () => {
  it('l euro torna sul credito, Stripe non si tocca, Maria non legge «a mano» e gli amministratori non devono renderlo', async () => {
    const esito = await giro('2026-10-30T17:16:00.000Z');
    expect(esito).toMatchObject({ ok: true, spostati: 1, daSistemareAMano: 0 });

    expect(stato.stripe.creati, 'nessun rimborso sulla carta').toEqual([]);
    expect(stato.crediti).toEqual([
      expect.objectContaining({ p_user: 'maria', p_cents: 100, p_ref: 'veloce_non_confermata_o1' }),
    ]);
    // Il conto dice il vero: l'euro tolto dalla consegna e dal credito speso, la carta com'era.
    expect(o1()).toMatchObject({ delivery_fee_cents: 300, gross_total_cents: 1800, wallet_applied_cents: 1740, total_price: 0.6, refunded_amount_cents: 0 });
    expect(Number(o1().wallet_applied_cents) + Math.round(Number(o1().total_price) * 100)).toBe(Number(o1().gross_total_cents));
    expect(String(o1().delivery_slot)).toMatch(/^Oggi · /);

    expect(campanella()).toHaveLength(1);
    expect(campanella()[0]).toContain('ti torna sul credito MyCity');
    expect(campanella()[0]).not.toContain('a mano');
    expect(campanella()[0]).not.toContain('sulla carta');
    expect(stato.avvisi.filter((a) => a.includes('a mano'))).toEqual([]);
  });

  it('due giri di fila: l euro torna sul credito una volta sola', async () => {
    await giro('2026-10-30T17:16:00.000Z');
    await giro('2026-10-30T17:21:00.000Z');
    expect(stato.crediti).toHaveLength(1);
    expect(o1()).toMatchObject({ wallet_applied_cents: 1740, gross_total_cents: 1800 });
    expect(campanella()).toHaveLength(1);
  });

  it('se il credito non torna, il cliente legge «a mano» e gli amministratori lo sanno, col conto com era', async () => {
    stato.creditoCade = true;
    await giro('2026-10-30T17:16:00.000Z');
    expect(stato.stripe.creati).toEqual([]);
    expect(o1()).toMatchObject({ delivery_fee_cents: 400, gross_total_cents: 1900, wallet_applied_cents: 1840 });
    expect(campanella()[0]).toContain('te lo rendiamo a mano');
    expect(stato.avvisi.some((a) => a.includes('#O1') && a.includes('credito MyCity'))).toBe(true);
  });

  it('con la carta che copre l euro resta il rimborso sulla carta, come prima', async () => {
    Object.assign(o1(), { total_price: 19, wallet_applied_cents: 0 });
    await giro('2026-10-30T17:16:00.000Z');
    expect(stato.stripe.creati).toEqual([100]);
    expect(stato.crediti).toEqual([]);
    expect(campanella()[0]).toContain('ti torna sulla carta');
  });
});

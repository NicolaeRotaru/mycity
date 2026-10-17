import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 15/10/2026 (R70) — DUE CONTROLLI SUI SOLDI SENZA UNA PROVA CHE LI TENESSE.
 *
 * La radiografia dell'11/10 ha tolto, in una copia del codice, due controlli
 * del webhook che crea gli ordini — e su 4.258 prove ne e' diventata rossa una
 * sola, che non c'entrava. Erano la riparazione di due difetti gia' chiusi, e
 * niente impediva che tornassero:
 *
 *  ① «sessione completata» non vuol dire «sessione pagata». Con un pagamento
 *    asincrono (bonifico SEPA, Klarna) Stripe manda `completed` con
 *    `payment_status: 'unpaid'`: senza il controllo nasce un ordine PAGATO, il
 *    negozio prepara la merce e un'ora dopo la consegna parte il bonifico al
 *    negozio — per soldi mai incassati;
 *  ② se l'incasso e' diverso dal preventivo l'ordine non nasce, il cliente
 *    viene rimborsato (una volta sola, con una chiave stabile) e il carrello
 *    si chiude in MISMATCH. Senza, l'ordine nasce col totale sbagliato e il
 *    rimborso non parte mai.
 *
 * Qui si esegue `handleCheckoutCompleted` vero, con un database finto che
 * regge TUTTA la strada fino alla creazione dell'ordine: se un controllo
 * sparisce, il codice arriva davvero a scrivere l'ordine, e la prova lo vede.
 */

type Operazione = { tabella: string; tipo: string; valori?: unknown; filtri: Array<[string, unknown]> };
const operazioni: Operazione[] = [];

const rimborsi = vi.fn(async (_corpo: Record<string, unknown>, _opzioni: { idempotencyKey: string }) => ({ id: 're_1' }));

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    paymentIntents: { retrieve: async () => ({ latest_charge: 'ch_1' }) },
    refunds: { create: rimborsi },
  }),
  computeOrderSplit: () => ({ applicationFeeCents: 250, sellerPayoutCents: 2250 }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/analytics/server', () => ({ analyticsConsentita: async () => false, contaAcquisto: async () => {} }));
vi.mock('next/server', () => ({ after: () => {} }));

let pending: Record<string, unknown> = {};

function risposta(op: Operazione): unknown {
  if (op.tabella === 'pending_checkouts' && op.tipo === 'select') return { data: { ...pending }, error: null };
  if (op.tabella === 'orders' && op.tipo === 'insert') return { data: { id: 'ordine-1' }, error: null };
  if (op.tabella === 'orders' && op.tipo === 'select') return { data: [], error: null };
  if (op.tabella === 'profiles' && op.tipo === 'select') return { data: [{ id: 'admin-1' }], error: null };
  return { data: [], error: null };
}

/** Ogni chiamata al database finisce in `operazioni`, con i suoi filtri. */
function catena(tabella: string) {
  const op: Operazione = { tabella, tipo: 'select', filtri: [] };
  let registrata = false;
  const registra = () => { if (!registrata) { operazioni.push(op); registrata = true; } };
  const b: Record<string, unknown> = {};
  for (const m of ['eq', 'in', 'is', 'lt', 'lte', 'gte', 'neq']) {
    b[m] = (col: string, val: unknown) => { op.filtri.push([col, val]); return b; };
  }
  for (const m of ['order', 'limit']) b[m] = () => b;
  b.select = () => b;
  for (const m of ['insert', 'update', 'delete', 'upsert']) {
    b[m] = (valori?: unknown) => { op.tipo = m; op.valori = valori; return b; };
  }
  b.single = () => { registra(); return Promise.resolve(risposta(op)); };
  b.maybeSingle = b.single;
  b.then = (r: (v: unknown) => unknown) => { registra(); return Promise.resolve(risposta(op)).then(r); };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => catena(t),
    rpc: async () => ({ data: null, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@example.it' } } }) } },
  }),
}));

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';

function sessione(sopra: Record<string, unknown> = {}) {
  return {
    id: 'cs_1',
    payment_status: 'paid',
    client_reference_id: 'pc_1',
    amount_total: 2500,
    payment_intent: 'pi_1',
    customer_details: { email: 'maria@example.it', name: 'Maria Rossi' },
    metadata: {},
    ...sopra,
  } as never;
}

const ordiniScritti = () => operazioni.filter((o) => o.tabella === 'orders' && o.tipo === 'insert');

beforeEach(() => {
  operazioni.length = 0;
  rimborsi.mockClear();
  pending = {
    id: 'pc_1',
    buyer_id: 'cliente-1',
    status: 'PENDING',
    total_cents: 2500,
    stripe_session_id: 'cs_1',
    coupon_code: null,
    pickup_in_store: false,
    delivery: { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: null },
    groups: [{
      sellerId: 'negozio-1', storeName: 'Pane Quotidiano', totalCents: 2500, shippingCents: 0, deliveryFeeCents: 0,
      riderFeeCents: 300, couponPortionCents: 0, pickupPortionCents: 0,
      items: [{ productId: 'p1', name: 'Pane', quantity: 2, unitAmountCents: 1250 }],
    }],
  };
});

describe('il webhook della carta', () => {
  it('la strada di controllo: sessione pagata e incasso giusto creano l ordine', async () => {
    // Senza questo verde le due prove sotto potrebbero passare perche' il
    // finto non regge la strada, non perche' i controlli funzionano.
    await handleCheckoutCompleted(sessione());
    expect(ordiniScritti(), 'il finto non arriva a scrivere l ordine: le prove sotto non misurano niente').toHaveLength(1);
  });

  it('① una sessione completata ma non pagata NON crea ordini', async () => {
    await expect(handleCheckoutCompleted(sessione({ payment_status: 'unpaid' }))).resolves.toBeUndefined();
    expect(
      ordiniScritti(),
      'nasce un ordine PAGATO per soldi mai arrivati: il negozio prepara, e il bonifico al negozio parte',
    ).toHaveLength(0);
    expect(rimborsi).not.toHaveBeenCalled();
  });

  it('② un incasso diverso dal preventivo NON crea ordini, rimborsa una volta e chiude il carrello', async () => {
    // Preventivo 25,00 €, Stripe ha incassato 22,00 €.
    await expect(handleCheckoutCompleted(sessione({ amount_total: 2200 }))).resolves.toBeUndefined();

    expect(ordiniScritti(), 'l ordine nasce col totale sbagliato rispetto a quanto e entrato').toHaveLength(0);
    expect(rimborsi, 'il cliente ha pagato, l ordine non c e, e il rimborso non parte').toHaveBeenCalledTimes(1);
    const [corpo, opzioni] = rimborsi.mock.calls[0];
    expect(corpo.payment_intent).toBe('pi_1');
    expect(opzioni.idempotencyKey, 'senza una chiave stabile un doppio arrivo rimborsa due volte').toBe('refund_quadratura_pc_1');

    const chiusura = operazioni.find((o) => o.tabella === 'pending_checkouts' && o.tipo === 'update');
    expect(chiusura?.valori, 'il carrello resta aperto e il prossimo giro ci riprova').toEqual({ status: 'MISMATCH' });
    expect(chiusura?.filtri).toContainEqual(['id', 'pc_1']);
  });

  it('② uno scarto di un centesimo (arrotondamento) non e una quadratura fallita', async () => {
    await handleCheckoutCompleted(sessione({ amount_total: 2501 }));
    expect(ordiniScritti()).toHaveLength(1);
    expect(rimborsi).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fasciaLeggibile } from '@/lib/ordini/fascia-leggibile';

/**
 * 31/10/2026 (ondata 5) — CON LA CARTA LA FASCIA SI GUARDA QUANDO SI PAGA, E SI SCRIVE DAL GIORNO
 * DELL'ORDINE.
 *
 * La rotta della carta controlla la fascia quando apre la pagina di Stripe; l'ordine nasce al
 * webhook, quando i soldi arrivano. Due difetti nella stessa crepa:
 *  ① «Domani · 9:00–11:00» scelto lunedì alle 23:50 e pagato alle 00:10 finiva su un ordine nato
 *    martedì, e negozio, fattorino, cliente ed email leggevano mercoledì;
 *  ② «Oggi · 13:00–16:30» scelto alle 12:40 (Pane Quotidiano chiude alle 13:00) e pagato alle 12:47
 *    o alle 13:01 diventava un ordine che il negozio non poteva più servire: lo annullava il giro.
 * La prova passa dal webhook vero; Stripe e il database sono finti, gli orari sono quelli del forno.
 */
const { ORARI_PQ } = vi.hoisted(() => {
  const giorno = [['09:00', '13:00'], ['16:30', '19:30']];
  return {
    ORARI_PQ: { mon: giorno, tue: giorno, wed: giorno, thu: [['09:00', '13:00']], fri: giorno, sat: giorno, sun: [] },
  };
});

const registro = vi.hoisted(() => ({
  ordini: [] as Array<Record<string, unknown>>,
  rimborsi: [] as Array<{ dati: Record<string, unknown>; chiave?: string }>,
  carrello: [] as Array<Record<string, unknown>>,
  rpc: [] as string[],
  email: [] as Array<{ to: string; text?: string }>,
  fascia: null as string | null,
}));

const dopoLaRisposta: Array<() => Promise<void>> = [];
vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => { dopoLaRisposta.push(fn); },
  NextResponse: { json: (b: unknown, i?: ResponseInit) => new Response(JSON.stringify(b), i) },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string; text?: string }) => { registro.email.push(m); return { ok: true }; },
}));
vi.mock('@/lib/email/templates', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  orderConfirmedBuyerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
}));
vi.mock('@/lib/analytics/server', () => ({ analyticsConsentita: async () => false, contaAcquisto: async () => {} }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    paymentIntents: { retrieve: async () => ({ latest_charge: 'ch_1' }) },
    refunds: {
      create: async (dati: Record<string, unknown>, opz?: { idempotencyKey?: string }) => {
        registro.rimborsi.push({ dati, chiave: opz?.idempotencyKey });
        return { id: 're_1' };
      },
    },
  }),
  computeOrderSplit: () => ({ applicationFeeCents: 150, sellerPayoutCents: 1350 }),
}));

const PENDING = () => ({
  id: 'pc_1', buyer_id: 'buyer-1', status: 'PENDING', total_cents: 1800, stripe_session_id: 'cs_1', coupon_code: null,
  pickup_in_store: false, expires_at: null,
  delivery: { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: registro.fascia },
  groups: [{
    sellerId: 'pane-quotidiano', storeName: 'Pane Quotidiano', totalCents: 1800, shippingCents: 0, deliveryFeeCents: 300,
    riderFeeCents: 300, couponPortionCents: 0, pickupPortionCents: 0, subtotalCents: 1500,
    items: [{ productId: 'p1', name: 'Pane', quantity: 1, unitAmountCents: 1500 }],
  }],
});

/** Una query finta: ogni anello torna sé stessa, e l'attesa risponde secondo tabella e operazione. */
function query(tabella: string) {
  const stato = { op: 'select', colonne: '' };
  const risposta = () => {
    if (tabella === 'profiles') {
      return { data: /store_hours/.test(stato.colonne) ? { store_name: 'Pane Quotidiano', store_hours: ORARI_PQ } : null, error: null };
    }
    if (tabella === 'pending_checkouts') return { data: stato.op === 'update' ? [PENDING()] : PENDING(), error: null };
    if (tabella === 'orders') return { data: stato.op === 'insert' ? { id: `o${registro.ordini.length}` } : [], error: null };
    return { data: null, error: null };
  };
  const c: Record<string, unknown> = {};
  for (const m of ['eq', 'neq', 'in', 'is', 'gt', 'lt', 'gte', 'lte', 'order', 'limit', 'filter', 'not', 'or', 'match']) c[m] = () => c;
  c.select = (colonne?: string) => { if (stato.op === 'select') stato.colonne = String(colonne ?? ''); return c; };
  c.insert = (riga: Record<string, unknown>) => { stato.op = 'insert'; if (tabella === 'orders') registro.ordini.push(riga); return c; };
  c.update = (riga: Record<string, unknown>) => { stato.op = 'update'; if (tabella === 'pending_checkouts') registro.carrello.push(riga); return c; };
  c.upsert = () => { stato.op = 'upsert'; return c; };
  c.delete = () => { stato.op = 'delete'; return c; };
  c.single = async () => risposta();
  c.maybeSingle = async () => risposta();
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risposta()).then(ok, ko);
  return c;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => query(tabella),
    rpc: async (nome: string) => { registro.rpc.push(nome); return { data: null, error: null }; },
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@negozio.test` } } }) } },
  }),
}));

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';

/** La pagina di Stripe nasce a `scelta`, i soldi arrivano a `pagato` (orari UTC: Piacenza è UTC+1 a novembre). */
async function paga(scelta: string, pagato: string, fascia: string) {
  registro.fascia = fascia;
  vi.setSystemTime(new Date(pagato));
  const sessione = {
    id: 'cs_1', payment_status: 'paid', client_reference_id: 'pc_1', amount_total: 1800, payment_intent: 'pi_1',
    created: Math.floor(new Date(scelta).getTime() / 1000),
    customer_details: { email: 'cliente@test.it', name: 'Maria Rossi' }, metadata: {},
  } as never;
  await handleCheckoutCompleted(sessione);
  for (const lavoro of dopoLaRisposta) await lavoro();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  registro.ordini.length = 0;
  registro.rimborsi.length = 0;
  registro.carrello.length = 0;
  registro.rpc.length = 0;
  registro.email.length = 0;
  dopoLaRisposta.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('con la carta la fascia vale dal giorno dell’ordine', () => {
  it('lunedì 23:50 «Domani · 9:00–11:00», pagato martedì 00:10: tutti leggono martedì 3/11, non mercoledì', async () => {
    await paga('2026-11-02T22:50:00.000Z', '2026-11-02T23:10:00.000Z', 'Domani · 9:00–11:00');
    expect(registro.rimborsi).toEqual([]);
    expect(registro.ordini).toHaveLength(1);
    const ordine = registro.ordini[0] as { delivery_slot?: string | null };
    // L'ordine nasce martedì: la stessa fascia, detta da martedì, è «Oggi».
    expect(ordine.delivery_slot).toBe('Oggi · 9:00–11:00');
    expect(fasciaLeggibile({ delivery_slot: ordine.delivery_slot, created_at: new Date().toISOString() })).toBe('mar 3/11 · 9:00–11:00');
    // E l'email al negozio non conta la scadenza da mercoledì.
    const alNegozio = registro.email.find((m) => m.to === 'pane-quotidiano@negozio.test');
    expect(alNegozio, 'il negozio non ha ricevuto l email').toBeTruthy();
    expect(alNegozio?.text).not.toContain('di domani');
  });

  it('pagato lo stesso giorno: la fascia resta quella scelta', async () => {
    await paga('2026-11-02T11:00:00.000Z', '2026-11-02T11:05:00.000Z', 'Oggi · 13:00–16:30');
    expect(registro.rimborsi).toEqual([]);
    expect(registro.ordini.map((o) => o.delivery_slot)).toEqual(['Oggi · 13:00–16:30']);
  });
});

describe('con la carta la fascia si ricontrolla quando arrivano i soldi', () => {
  for (const [ora, pagato] of [['12:47', '2026-11-02T11:47:00.000Z'], ['13:01', '2026-11-02T12:01:00.000Z']] as const) {
    it(`lunedì 12:40 «Oggi · 13:00–16:30», pagato alle ${ora} a forno chiuso: rimborso subito, nessun ordine`, async () => {
      await paga('2026-11-02T11:40:00.000Z', pagato, 'Oggi · 13:00–16:30');
      expect(registro.ordini, 'è nato un ordine che il negozio non può più servire').toEqual([]);
      expect(registro.rimborsi).toHaveLength(1);
      expect(registro.rimborsi[0].dati.payment_intent).toBe('pi_1');
      expect(registro.rimborsi[0].chiave).toBe('refund_fascia_pc_1');
      expect(registro.carrello).toContainEqual({ status: 'CANCELED' });
      expect(registro.rpc).toContain('restore_stock');
    });
  }

  it('«Domani» scelto lunedì e pagato mercoledì: il giorno è passato, rimborso', async () => {
    await paga('2026-11-02T10:00:00.000Z', '2026-11-04T10:00:00.000Z', 'Domani · 9:00–11:00');
    expect(registro.ordini).toEqual([]);
    expect(registro.rimborsi).toHaveLength(1);
  });
});

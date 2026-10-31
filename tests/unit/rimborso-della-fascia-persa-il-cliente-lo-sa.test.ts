import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 31/10/2026 (ondata 5, dopo il collaudo) — IL RIMBORSO AL PAGAMENTO, IL CLIENTE LO SA.
 *
 * Con la carta la fascia si ricontrolla quando arrivano i soldi: se il negozio non può più servirla,
 * si rimborsa e non nasce nessun ordine. Lo sapevano solo gli amministratori. Il cliente aveva
 * pagato, non riceveva né email né campanella, e dopo 30 secondi la pagina degli ordini gli diceva
 * «nessun ordine»: soldi addebitati e spariti, ai suoi occhi. Lunedì alle 12:40 sceglie
 * «Oggi · 13:00–16:30» da Pane Quotidiano (chiude alle 13:00), paga alle 12:47: adesso gli arriva
 * una campanella e un'email che dicono quanto torna, perché, e che non c'è nessun ordine.
 * Stripe che riconsegna lo stesso evento non gli manda il messaggio due volte.
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
  avvisi: [] as Array<Record<string, unknown>>,
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
  const stato = { op: 'select', colonne: '', doppio: false };
  const risposta = () => {
    if (tabella === 'profiles') {
      return { data: /store_hours/.test(stato.colonne) ? { store_name: 'Pane Quotidiano', store_hours: ORARI_PQ } : null, error: null };
    }
    if (tabella === 'pending_checkouts') return { data: stato.op === 'update' ? [PENDING()] : PENDING(), error: null };
    // La tabella degli avvisi rifiuta una seconda riga con lo stesso id, come il database (23505).
    if (tabella === 'notifications') return { data: null, error: stato.doppio ? { code: '23505', message: 'duplicate key' } : null };
    if (tabella === 'orders') return { data: stato.op === 'insert' ? { id: `o${registro.ordini.length}` } : [], error: null };
    return { data: null, error: null };
  };
  const c: Record<string, unknown> = {};
  for (const m of ['eq', 'neq', 'in', 'is', 'gt', 'lt', 'gte', 'lte', 'order', 'limit', 'filter', 'not', 'or', 'match']) c[m] = () => c;
  c.select = (colonne?: string) => { if (stato.op === 'select') stato.colonne = String(colonne ?? ''); return c; };
  c.insert = (riga: Record<string, unknown>) => { stato.op = 'insert'; if (tabella === 'orders') registro.ordini.push(riga);
    if (tabella === 'notifications') {
      const righe = (Array.isArray(riga) ? riga : [riga]) as Array<Record<string, unknown>>;
      stato.doppio = righe.some((r) => r.id != null && registro.avvisi.some((a) => a.id === r.id));
      if (!stato.doppio) registro.avvisi.push(...righe);
    }
    return c;
  };
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
  registro.avvisi.length = 0;
  dopoLaRisposta.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('rimborso al pagamento: il cliente lo sa', () => {
  it('lunedì 12:40 «Oggi · 13:00–16:30», pagato alle 12:47: campanella ed email al cliente', async () => {
    await paga('2026-11-02T11:40:00.000Z', '2026-11-02T11:47:00.000Z', 'Oggi · 13:00–16:30');
    expect(registro.ordini).toEqual([]);
    expect(registro.rimborsi).toHaveLength(1);
    const alCliente = registro.avvisi.filter((a) => a.user_id === 'buyer-1');
    expect(alCliente, 'nessuna campanella al cliente rimborsato').toHaveLength(1);
    expect(String(alCliente[0].body)).toContain('18,00');
    expect(String(alCliente[0].body)).toContain('Oggi · 13:00–16:30');
    expect(String(alCliente[0].link)).not.toMatch(/^\/orders\//);
    const email = registro.email.filter((m) => m.to === 'cliente@test.it');
    expect(email, 'nessuna email al cliente rimborsato').toHaveLength(1);
    expect(email[0].text).toContain('18,00');
    expect(email[0].text).toMatch(/nessun ordine/i);
  });

  it('Stripe riconsegna lo stesso evento: il cliente riceve il messaggio una volta sola', async () => {
    await paga('2026-11-02T11:40:00.000Z', '2026-11-02T11:47:00.000Z', 'Oggi · 13:00–16:30');
    await paga('2026-11-02T11:40:00.000Z', '2026-11-02T11:48:00.000Z', 'Oggi · 13:00–16:30');
    expect(registro.rimborsi.map((r) => r.chiave)).toEqual(['refund_fascia_pc_1', 'refund_fascia_pc_1']);
    expect(registro.avvisi.filter((a) => a.user_id === 'buyer-1')).toHaveLength(1);
    expect(registro.email.filter((m) => m.to === 'cliente@test.it')).toHaveLength(1);
  });

  it('una fascia che si può ancora servire non manda nessun messaggio di rimborso', async () => {
    await paga('2026-11-02T11:00:00.000Z', '2026-11-02T11:05:00.000Z', 'Oggi · 13:00–16:30');
    expect(registro.rimborsi).toEqual([]);
    expect(registro.ordini).toHaveLength(1);
    expect(registro.email.filter((m) => m.to === 'cliente@test.it' && /rimbors/i.test(m.text ?? ''))).toEqual([]);
  });
});

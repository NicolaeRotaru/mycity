import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { fraseDelBonificoInArrivo, statoPagamento, type StatoPagamento } from '@/lib/ordini/riepilogo-ordine';
import { ilBonificoCheIlClienteAspetta } from '@/lib/rimborsi/bonifico-del-cliente';

/**
 * Riesame del 16/10, quarto giro — «ORDINE RIMBORSATO.» PRIMA CHE PARTISSE IL BONIFICO.
 *
 * Giulia rende un maglione da 40 € pagato in contanti. Il negozio rimborsa: lo stato del pagamento
 * diventa «rimborsato» subito, ma i soldi li manda a mano chi amministra, con un bonifico, dopo. La
 * pagina dell'ordine guardava solo lo stato e diceva «Ordine rimborsato.» dal primo minuto; l'email
 * invece diceva «per fare il bonifico ci serve il tuo IBAN: scrivici». Chi legge la pagina pensa di
 * avere gia' i soldi e non scrive — e senza IBAN il bonifico non parte mai.
 *
 * Girano le rotte vere: apertura e decisione del reso, chiusura di un reclamo, il «Bonifico fatto»
 * di chi paga, e la rotta che dice alla pagina che cosa aspetta il cliente.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'giulia' }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => {
  type Gestore = (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown;
  const conUtente = (chi: () => string) => (handler: Gestore) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: chi() }, req, params: (await ctx?.params) ?? {} });
  return {
    withAuth: conUtente(() => finto.utente),
    withAuthRateLimit: (_o: unknown, handler: Gestore) => conUtente(() => finto.utente)(handler),
    withAdminAuth: conUtente(() => 'admin-1'),
  };
});

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as risolvi } from '@/app/api/admin/disputes/[id]/resolve/route';
import { POST as comandoDellaLista } from '@/app/api/admin/rimborsi-da-bonificare/route';
import { GET as bonificoDellOrdine } from '@/app/api/orders/[id]/bonifico-di-rimborso/route';

const ORDINE = '11111111-1111-4111-8111-111111111111';
const RESO = '22222222-2222-4222-8222-222222222222';
const RECLAMO = '33333333-3333-4333-8333-333333333333';
const IBAN = 'IT60X0542811101000000123456';
const euro = (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`;

function maglione(): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio', total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, refunded_amount_cents: 0,
    payment_method: 'cod', rider_id: null, rider_transfer_id: null, rider_payout_status: null,
    rider_payout_reversed_cents: 0, rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), payment_status: 'PAID',
    cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(), internal_dispute_status: 'OPEN',
  };
}

const json = (corpo: unknown) => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
});
type Rotta = (r: Request, c: unknown) => Promise<Response>;

async function resoRimborsato(rimborso: Record<string, unknown>) {
  finto.utente = 'giulia';
  const aperto = await (apriReso as unknown as Rotta)(
    new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'CHANGED_MIND', rimborso })),
    undefined,
  );
  expect(aperto.status).toBe(201);
  const corto = (await aperto.json()).id as string;
  finto.db.tabelle.returns.find((r) => r.id === corto)!.id = RESO;
  finto.utente = 'negozio';
  const deciso = await (decidi as unknown as Rotta)(
    new Request('http://localhost/x', json({ decision: 'APPROVED', refundAmountCents: 4000 })),
    { params: Promise.resolve({ id: RESO }) },
  );
  expect(deciso.status).toBe(200);
}

/** Quello che la pagina dell'ordine mostra a Giulia, passando dalla rotta vera. */
async function cosaVedeGiulia(): Promise<StatoPagamento> {
  finto.utente = 'giulia';
  const res = await (bonificoDellOrdine as unknown as Rotta)(
    new Request(`http://localhost/api/orders/${ORDINE}/bonifico-di-rimborso`),
    { params: Promise.resolve({ id: ORDINE }) },
  );
  expect(res.status).toBe(200);
  const bonifico = await res.json();
  return statoPagamento(finto.db.tabelle.orders[0], 4000, bonifico);
}

beforeEach(() => {
  finto.db = creaFintoDatabase({
    orders: [maglione()],
    returns: [],
    order_items: [],
    bonifici_dei_reclami: [],
    disputes: [{ id: RECLAMO, status: 'open', order_id: ORDINE, opener_id: 'giulia', against_id: 'negozio' }],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
    notifications: [],
  });
});

describe('reso in contanti col bonifico: la pagina dice «in arrivo» finche il bonifico non e fatto', () => {
  it('senza IBAN nel reso: in arrivo, e chiede l IBAN come l email', async () => {
    await resoRimborsato({ modo: 'BONIFICO', iban: IBAN });
    // L'IBAN si perde (per esempio un reso nato prima della 162): la pagina lo deve chiedere.
    finto.db.tabelle.returns[0].refund_iban = null;
    expect(finto.db.tabelle.orders[0].payment_status).toBe('REFUNDED');

    const s = await cosaVedeGiulia();
    expect(s.tipo, 'la pagina dice «Ordine rimborsato.» prima che parta il bonifico').toBe('bonifico-in-arrivo');
    if (s.tipo !== 'bonifico-in-arrivo') return;
    expect(s).toMatchObject({ centesimi: 4000, serveIban: true, certo: true });
    const frase = fraseDelBonificoInArrivo(s, euro);
    expect(frase).toContain('in arrivo con un bonifico');
    expect(frase).toContain('ci serve il tuo IBAN');
    expect(frase).not.toMatch(/rimborsato/iu);
  });

  it('con l IBAN: in arrivo, senza chiederlo; dopo «Bonifico fatto»: rimborsato', async () => {
    await resoRimborsato({ modo: 'BONIFICO', iban: IBAN });
    const prima = await cosaVedeGiulia();
    expect(prima).toMatchObject({ tipo: 'bonifico-in-arrivo', centesimi: 4000, serveIban: false });

    const fatto = await (comandoDellaLista as unknown as Rotta)(
      new Request('http://localhost/api/admin/rimborsi-da-bonificare', json({ resoId: RESO, azione: 'fatto' })),
      undefined,
    );
    expect(fatto.status).toBe(200);
    expect(await cosaVedeGiulia()).toEqual({ tipo: 'rimborsato' });
  });

  it('se il cliente ha scelto il credito, nessun bonifico: «rimborsato» subito, come prima', async () => {
    await resoRimborsato({ modo: 'CREDITO' });
    expect(await cosaVedeGiulia()).toEqual({ tipo: 'rimborsato' });
  });
});

describe('reclamo chiuso a favore del cliente su un ordine in contanti', () => {
  it('in arrivo col bonifico, e l IBAN serve (il modulo del reclamo non lo chiede)', async () => {
    const res = await (risolvi as unknown as Rotta)(
      new Request('http://localhost/x', json({ status: 'resolved_buyer', notes: 'Merce arrivata rovinata, rimborsiamo.', refundCents: 2400 })),
      { params: Promise.resolve({ id: RECLAMO }) },
    );
    expect(res.status).toBe(200);
    expect(finto.db.tabelle.orders[0].payment_status).toBe('PARTIALLY_REFUNDED');
    expect(await cosaVedeGiulia()).toMatchObject({ tipo: 'bonifico-in-arrivo', centesimi: 2400, serveIban: true });
  });
});

describe('la rotta del bonifico la legge solo chi ha fatto l ordine', () => {
  it('un altro cliente riceve «non trovato», e la rotta non restituisce mai l IBAN', async () => {
    await resoRimborsato({ modo: 'BONIFICO', iban: IBAN });
    finto.utente = 'marco';
    const res = await (bonificoDellOrdine as unknown as Rotta)(
      new Request(`http://localhost/api/orders/${ORDINE}/bonifico-di-rimborso`),
      { params: Promise.resolve({ id: ORDINE }) },
    );
    expect(res.status).toBe(404);
    finto.utente = 'giulia';
    const mia = await (bonificoDellOrdine as unknown as Rotta)(
      new Request(`http://localhost/api/orders/${ORDINE}/bonifico-di-rimborso`),
      { params: Promise.resolve({ id: ORDINE }) },
    );
    expect(JSON.stringify(await mia.json())).not.toContain('IT60');
  });
});

describe('la regola, senza rotte', () => {
  it('finche non si sa niente del bonifico, su un ordine in contanti rimborsato non si dice niente', () => {
    expect(statoPagamento({ payment_method: 'cod', payment_status: 'REFUNDED' }, 4000, 'non-lo-so')).toEqual({ tipo: 'non-lo-so' });
  });
  it('senza la 162 il «fatto» non si sa: la frase non promette, rimanda ai Contatti', () => {
    const b = ilBonificoCheIlClienteAspetta({
      ordine: { stripe_refund_id: `bonifico:4000:return_${RESO}` }, resi: [], reclami: [], con162: false,
    });
    expect(b).toEqual({ daFareCents: 4000, serveIban: false, certo: false });
    const s = statoPagamento({ payment_method: 'cod', payment_status: 'REFUNDED' }, 4000, b);
    if (s.tipo !== 'bonifico-in-arrivo') throw new Error(`atteso bonifico in arrivo, arrivato ${s.tipo}`);
    expect(fraseDelBonificoInArrivo(s, euro)).toMatch(/Se non ti è ancora arrivato, scrivici/u);
  });
  it('la carta non passa di qui', () => {
    expect(statoPagamento({ payment_method: 'card', payment_status: 'REFUNDED' }, 4000, { daFareCents: 4000, serveIban: true, certo: true }))
      .toEqual({ tipo: 'rimborsato' });
  });
});

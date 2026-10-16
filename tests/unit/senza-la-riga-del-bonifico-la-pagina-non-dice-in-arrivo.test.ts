import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';
import { fraseDelBonificoInArrivo, statoPagamento, type StatoPagamento } from '@/lib/ordini/riepilogo-ordine';
import { ilBonificoCheIlClienteAspetta } from '@/lib/rimborsi/bonifico-del-cliente';

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'giulia', guasto: false }));

vi.mock('@/lib/supabase/server', () => {
  const client = () => {
    const c = finto.db.client;
    return {
      ...c,
      from: (tabella: string) => {
        const q = c.from(tabella) as unknown as Record<string, (...a: unknown[]) => unknown>;
        if (tabella !== 'bonifici_dei_reclami' || !finto.guasto) return q;
        q.insert = () => Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
        return q;
      },
    };
  };
  return { getAdminSupabase: () => client(), getServerSupabase: async () => client() };
});
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({ refunds: { create: vi.fn(async () => ({ id: 're_1' })) }, transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) } }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => {
  type Gestore = (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown;
  const conUtente = (chi: () => string) => (handler: Gestore) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: chi() }, req, params: (await ctx?.params) ?? {} });
  return { withAuth: conUtente(() => finto.utente), withAdminAuth: conUtente(() => 'admin-1') };
});

import { POST as risolvi } from '@/app/api/admin/disputes/[id]/resolve/route';
import { POST as comandoDellaLista } from '@/app/api/admin/rimborsi-da-bonificare/route';
import { GET as bonificoDellOrdine } from '@/app/api/orders/[id]/bonifico-di-rimborso/route';

/**
 * Riesame del 16/10, quinto giro — «IN ARRIVO, CI SERVE IL TUO IBAN», PER SEMPRE.
 *
 * Nicola chiude a favore di Giulia un reclamo da 40 € su un ordine pagato in contanti. Il rimborso
 * si registra sull'ordine, poi la riga del bonifico (`bonifici_dei_reclami`) va in timeout. Chi paga
 * riceve l'avviso «fallo partendo da qui e tieni il conto a parte», e paga. Ma la pagina dell'ordine
 * contava i 40 € come ancora da fare — nessuna riga li poteva segnare fatti — e diceva a Giulia
 * «Rimborso in arrivo… ci serve il tuo IBAN», per sempre, anche coi soldi gia' sul conto.
 *
 * Adesso un bonifico registrato sull'ordine senza la riga dove si segna «fatto» non si dice «in
 * arrivo»: come senza la 162, la pagina dice quanto le restituiamo e, se non le e' arrivato, di
 * scriverci. Vero prima del bonifico e dopo.
 *
 * Girano le rotte vere (chiusura del reclamo, lista dei bonifici, rotta del bonifico del cliente) e
 * la `refundOrder` vera; il guasto e' uno solo, sull'inserimento della riga.
 */

const ORDINE = '11111111-1111-4111-8111-111111111111';
const RECLAMO = '33333333-3333-4333-8333-333333333333';
const euro = (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
type Rotta = (r: Request, c: unknown) => Promise<Response>;

function ordineInContanti(): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio', total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, refunded_amount_cents: 0,
    payment_method: 'cod', rider_id: null, rider_transfer_id: null, rider_payout_status: null,
    rider_payout_reversed_cents: 0, rider_fee_cents: 0, shipping_cost: 0, delivery_status: 'DELIVERED',
    payment_status: 'PAID', cash_confirmed_at: '2026-10-10T18:00:00Z', internal_dispute_status: 'OPEN',
  };
}

beforeEach(() => {
  finto.guasto = false;
  finto.db = creaFintoDatabase({
    orders: [ordineInContanti()],
    returns: [],
    bonifici_dei_reclami: [],
    disputes: [{ id: RECLAMO, status: 'open', order_id: ORDINE, opener_id: 'giulia', against_id: 'negozio' }],
    profiles: [{ id: 'admin-1', role: 'admin' }],
    notifications: [],
  });
});

async function chiudiIlReclamo() {
  const res = await (risolvi as unknown as Rotta)(
    new Request('http://localhost/x', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved_buyer', notes: 'Merce arrivata rovinata, rimborsiamo.', refundCents: 4000 }),
    }),
    { params: Promise.resolve({ id: RECLAMO }) },
  );
  expect(res.status).toBe(200);
}

async function cosaVedeGiulia(): Promise<StatoPagamento> {
  const res = await (bonificoDellOrdine as unknown as Rotta)(
    new Request(`http://localhost/api/orders/${ORDINE}/bonifico-di-rimborso`),
    { params: Promise.resolve({ id: ORDINE }) },
  );
  expect(res.status).toBe(200);
  return statoPagamento(finto.db.tabelle.orders[0], 4000, await res.json());
}

async function segnaFatto() {
  const res = await (comandoDellaLista as unknown as Rotta)(
    new Request('http://localhost/api/admin/rimborsi-da-bonificare', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reclamoId: RECLAMO, azione: 'fatto' }),
    }),
    undefined,
  );
  return res.status;
}

describe('un bonifico senza la riga dove si segna «fatto» non si dice «in arrivo»', () => {
  it('IL CASO CHE ROMPEVA — la riga del reclamo cade: la pagina non dice «in arrivo», ne prima ne dopo il bonifico', async () => {
    finto.guasto = true;
    await chiudiIlReclamo();
    expect(finto.db.tabelle.bonifici_dei_reclami, 'il guasto non e avvenuto: la prova non misura niente').toHaveLength(0);
    expect(notificheConTitolo(finto.db, 'fuori dalla lista'), 'chi paga non ha l avviso da cui pagare').toHaveLength(1);

    const prima = await cosaVedeGiulia();
    if (prima.tipo !== 'bonifico-in-arrivo') throw new Error(`atteso il riquadro del bonifico, arrivato ${prima.tipo}`);
    const frase = fraseDelBonificoInArrivo(prima, euro);
    expect(frase).toContain('40,00');
    expect(frase, 'la pagina promette un bonifico in arrivo che nessuno potra mai segnare fatto').not.toContain('in arrivo');
    expect(frase, 'la pagina chiede l IBAN per un bonifico che magari e gia stato pagato').not.toContain('ci serve il tuo IBAN');

    // Chi paga fa il bonifico dall'avviso, come l'avviso gli dice: dalla lista non si puo' segnare.
    expect(await segnaFatto()).toBe(409);
    const dopo = await cosaVedeGiulia();
    if (dopo.tipo !== 'bonifico-in-arrivo') throw new Error(`atteso il riquadro del bonifico, arrivato ${dopo.tipo}`);
    expect(fraseDelBonificoInArrivo(dopo, euro), 'dopo il bonifico la pagina dice ancora «in arrivo»').not.toContain('in arrivo');
  });

  it('controllo: con la riga, «in arrivo» e l IBAN; dopo «Bonifico fatto», rimborsato', async () => {
    await chiudiIlReclamo();
    const prima = await cosaVedeGiulia();
    expect(prima).toMatchObject({ tipo: 'bonifico-in-arrivo', centesimi: 4000, serveIban: true, certo: true });
    expect(await segnaFatto()).toBe(200);
    expect(await cosaVedeGiulia()).toEqual({ tipo: 'rimborsato' });
  });
});

describe('la regola, senza rotte', () => {
  it('un segno senza riga — reclamo, reso, o un altra strada — non e certo', () => {
    const base = { resi: [], reclami: [], con162: true };
    expect(ilBonificoCheIlClienteAspetta({ ...base, ordine: { stripe_refund_id: `bonifico:4000:dispute_${RECLAMO}` } }).certo).toBe(false);
    expect(ilBonificoCheIlClienteAspetta({ ...base, ordine: { stripe_refund_id: 'bonifico:4000:return_r9' } }).certo).toBe(false);
    expect(ilBonificoCheIlClienteAspetta({ ...base, ordine: { stripe_refund_id: 'bonifico:4000:cod_refund_x_tot_4000' } }).certo).toBe(false);
    expect(
      ilBonificoCheIlClienteAspetta({
        ...base,
        ordine: { stripe_refund_id: `bonifico:4000:dispute_${RECLAMO}` },
        reclami: [{ dispute_id: RECLAMO, fatto_at: null, iban: null }],
      }),
    ).toEqual({ daFareCents: 4000, serveIban: true, certo: true });
  });
});

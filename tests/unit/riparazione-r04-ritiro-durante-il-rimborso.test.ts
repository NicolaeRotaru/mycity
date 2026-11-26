import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * R04-011 · R04-013 — IL CLIENTE RITIRA IL RESO MENTRE IL NEGOZIO LO APPROVA COL RIMBORSO.
 *
 * `decide` prende il reso (APPROVED, con la cifra del rimborso) e chiama il rimborso, che dura
 * qualche secondo. In quei secondi il cliente preme «ritira la richiesta»: `avanza` lo lasciava
 * passare da APPROVED, scriveva CANCELED e mandava al negozio «↩ Il cliente ha ritirato la richiesta
 * di reso». Poi il rimborso usciva lo stesso: soldi al cliente, negozio che legge il contrario, e
 * `decide` che rispondeva 500 con un avviso agli amministratori.
 *
 * La prova fa girare le rotte VERE contro il finto database dei rimborsi: il ritiro del cliente
 * arriva mentre il credito del rimborso sta uscendo.
 */

const finto = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  utente: 'giulia',
  ritiroDurante: null as string | null,
  esitoRitiro: null as number | null,
}));

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
    withAuthRateLimit: (_o: unknown, handler: Gestore) => conUtente(() => finto.utente)(handler),
    withAdminAuth: conUtente(() => 'admin-1'),
  };
});

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';

const ORDINE = 'a1b2c3d4-7777-4777-8777-777777777777';
type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
const RITIRATO = '↩ Il cliente ha ritirato la richiesta di reso';

function coiCrediti(): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio',
    total_price: 0, gross_total_cents: 4000, wallet_applied_cents: 4000,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    payment_status: 'PAID', cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(),
    internal_dispute_status: null,
    cash_photo_url: null, delivery_photo_url: null, cash_signature_url: null,
  };
}

const ritira = (id: string) =>
  (avanza as unknown as Rotta)(new Request('http://localhost/x', json({ stato: 'CANCELED' })), { params: Promise.resolve({ id }) });

/** Mentre il credito del rimborso sta uscendo, il cliente preme «ritira la richiesta». */
function ilClienteRitiraDuranteIlRimborso(db: FintoDatabase) {
  const rpc = db.client.rpc.bind(db.client);
  db.client.rpc = async (nome: string, args?: Record<string, unknown>) => {
    if (nome === 'wallet_credit' && finto.ritiroDurante) {
      const id = finto.ritiroDurante;
      finto.ritiroDurante = null;
      const prima = finto.utente;
      finto.utente = 'giulia';
      finto.esitoRitiro = (await ritira(id)).status;
      finto.utente = prima;
    }
    return rpc(nome, args);
  };
}

async function apri(): Promise<string> {
  finto.utente = 'giulia';
  const aperto = await (apriReso as unknown as Rotta)(
    new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'DAMAGED', description: 'Arrivato rotto, la scatola era schiacciata' })),
    undefined,
  );
  expect(aperto.status).toBe(201);
  return (await aperto.json()).id as string;
}

const campanelleAlNegozio = () => (finto.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'negozio').map((n) => n.title);

beforeEach(() => {
  finto.utente = 'giulia';
  finto.ritiroDurante = null;
  finto.esitoRitiro = null;
  finto.db = creaFintoDatabase({
    orders: [coiCrediti()],
    returns: [],
    order_items: [],
    disputes: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }, { id: 'giulia', role: 'buyer' }],
    notifications: [],
    cod_reconciliations: [],
  });
  finto.db.email.giulia = 'giulia.bianchi@example.it';
  ilClienteRitiraDuranteIlRimborso(finto.db);
});

describe('R04-011 · R04-013 — il ritiro del cliente mentre il rimborso approvato sta uscendo', () => {
  it('IL CASO DELLE SCHEDE — il ritiro non passa, il negozio non legge «ritirato», il reso finisce rimborsato', async () => {
    const id = await apri();
    finto.ritiroDurante = id;
    finto.utente = 'negozio';

    const deciso = await (decidi as unknown as Rotta)(
      new Request('http://localhost/x', json({ decision: 'APPROVED', refundAmountCents: 2000 })),
      { params: Promise.resolve({ id }) },
    );

    expect(finto.esitoRitiro, 'il ritiro passa mentre il rimborso sta uscendo').toBe(409);
    expect(campanelleAlNegozio(), 'il negozio legge «il cliente ha ritirato» su un reso che si sta rimborsando').not.toContain(RITIRATO);
    expect(deciso.status, 'la decisione col rimborso risponde 500 perché il reso è stato ritirato nel frattempo').toBe(200);
    expect(finto.db.tabelle.returns[0].status).toBe('REFUNDED');
  }, 60000);

  it('un reso rimasto APPROVATO con un rimborso (esito non scritto) non si ritira', async () => {
    const id = await apri();
    const reso = finto.db.tabelle.returns[0];
    Object.assign(reso, { status: 'APPROVED', refund_amount_cents: 2000, decided_at: new Date().toISOString(), decided_by: 'negozio' });

    const r = await ritira(id);

    expect(r.status, 'il ritiro chiude «senza rimborso» un reso il cui rimborso è partito').toBe(409);
    expect(finto.db.tabelle.returns[0].status).toBe('APPROVED');
    expect(campanelleAlNegozio()).not.toContain(RITIRATO);
  });

  it('approvato SENZA rimborso subito, il cliente lo può ancora ritirare', async () => {
    const id = await apri();
    const reso = finto.db.tabelle.returns[0];
    Object.assign(reso, { status: 'APPROVED', refund_amount_cents: null, decided_at: new Date().toISOString(), decided_by: 'negozio' });

    const r = await ritira(id);

    expect(r.status).toBe(200);
    expect(finto.db.tabelle.returns[0].status).toBe('CANCELED');
    expect(campanelleAlNegozio()).toContain(RITIRATO);
  });
});

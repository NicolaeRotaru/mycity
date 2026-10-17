import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';
import { verdettoDelCredito } from '@/lib/rimborsi/credito-da-controllare';

/**
 * Riesame del 16/10, quarto giro — L'AVVISO CHIEDEVA UN CONTROLLO CHE DAL PANNELLO NON SI POTEVA FARE.
 *
 * Giulia rende un maglione da 50 €, pagato con 20 € di credito MyCity e 30 in contanti: i 30 tornano
 * col bonifico, i 20 come credito. Il credito esce, ma subito dopo il diario del credito non risponde:
 * la cifra non si verifica. Il rimborso si registra lo stesso (il credito e' gia' uscito) e chi
 * amministra riceve «Rimborso col credito da controllare»: «controlla che la riga cod_refund con
 * riferimento … dica 20,00 €», con un link a
 * /admin/orders. Li' il diario del credito non c'era, e in nessun'altra pagina del pannello: il
 * controllo si poteva fare solo aprendo il database. Se la cifra fosse stata diversa, dal pannello
 * nessuno l'avrebbe vista.
 *
 * Girano le rotte vere: apertura e decisione del reso con la `refundOrder` vera, poi la rotta del
 * controllo all'indirizzo che l'avviso porta.
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
import { GET as controllo } from '@/app/api/admin/credito-del-rimborso/route';

const ORDINE = '11111111-1111-4111-8111-111111111111';
const AVVISO = 'Rimborso col credito da controllare';
type Rotta = (r: Request, c: unknown) => Promise<Response>;

function maglione(): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio', total_price: 30, gross_total_cents: 5000, wallet_applied_cents: 2000,
    seller_payout_cents: 4500, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, refunded_amount_cents: 0,
    payment_method: 'cod', rider_id: null, rider_transfer_id: null, rider_payout_status: null,
    rider_payout_reversed_cents: 0, rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), payment_status: 'PAID',
    cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(), internal_dispute_status: null,
  };
}

const json = (corpo: unknown) => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
});

/** Il reso dell'ordine misto, deciso mentre il diario del credito non risponde: l'avviso parte. */
async function rimborsoColDiarioMuto(): Promise<{ link: string; body: string }> {
  finto.utente = 'giulia';
  const aperto = await (apriReso as unknown as Rotta)(
    new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'DAMAGED' })),
    undefined,
  );
  expect(aperto.status).toBe(201);
  const id = (await aperto.json()).id as string;
  finto.utente = 'negozio';
  finto.db.guasti.diarioIlleggibile = 99;
  const deciso = await (decidi as unknown as Rotta)(
    new Request('http://localhost/x', json({ decision: 'APPROVED', refundAmountCents: 5000 })),
    { params: Promise.resolve({ id }) },
  );
  finto.db.guasti.diarioIlleggibile = 0;
  expect(deciso.status).toBe(200);
  const avvisi = notificheConTitolo(finto.db, AVVISO);
  expect(avvisi, 'l avviso del credito da controllare non e partito: la prova non misura niente').toHaveLength(1);
  return { link: String(avvisi[0].link), body: String(avvisi[0].body) };
}

/** Quello che vede chi apre il link dell'avviso: la rotta del controllo, con l'indirizzo dell'avviso. */
async function apriIlLink(link: string) {
  const res = await (controllo as unknown as Rotta)(new Request(`http://localhost${link.replace('/admin/', '/api/admin/')}`), undefined);
  return { status: res.status, corpo: await res.json() };
}

beforeEach(() => {
  finto.db = creaFintoDatabase({
    orders: [maglione()],
    returns: [],
    order_items: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }, { id: 'giulia', wallet_balance_cents: 2000 }],
    notifications: [],
  });
});

describe('l avviso porta a un controllo che il pannello sa fare', () => {
  it('il link non porta piu alla lista ordini, ma a una pagina che c e e che legge il diario', async () => {
    const { link } = await rimborsoColDiarioMuto();
    expect(link, 'l avviso manda dove il diario del credito non si vede').not.toBe('/admin/orders');
    const pagina = link.split('?')[0];
    expect(existsSync(path.join(process.cwd(), 'app', pagina, 'page.tsx')), `la pagina ${pagina} non esiste`).toBe(true);

    const { status, corpo } = await apriIlLink(link);
    expect(status).toBe(200);
    expect(corpo.attesoCents).toBe(2000);
    expect(corpo.righe).toHaveLength(1);
    expect(corpo.saldoCents).toBe(2000);
    expect(corpo.verdetto).toMatchObject({ esito: 'torna', scrittoCents: 2000 });
  });

  it('LA VARIANTE SCOMODA — un tentativo prima aveva dato un altra cifra: il controllo dice che non torna', async () => {
    const { link } = await rimborsoColDiarioMuto();
    // La riga del diario con quella chiave dice 30 €, non 20: e' il caso per cui l'avviso esiste.
    finto.db.tabelle.wallet_ledger[0].delta_cents = 3000;
    const { corpo } = await apriIlLink(link);
    expect(corpo.verdetto.esito, 'una cifra diversa passa per buona').toBe('diverso');
    expect(corpo.verdetto.frase).toMatch(/Non torna/u);
    expect(corpo.verdetto.frase).toMatch(/30,00\s€/u);
    expect(corpo.verdetto.frase).toMatch(/20,00\s€/u);
  });

  it('nessuna riga col riferimento: il controllo lo dice, non fa finta di niente', async () => {
    const { link } = await rimborsoColDiarioMuto();
    finto.db.tabelle.wallet_ledger.length = 0;
    const { corpo } = await apriIlLink(link);
    expect(corpo.verdetto.esito).toBe('assente');
  });

  it('il diario che non risponde nemmeno adesso: errore, non un verdetto', async () => {
    const { link } = await rimborsoColDiarioMuto();
    finto.db.guasti.diarioIlleggibile = 1;
    expect((await apriIlLink(link)).status).toBe(500);
  });
});

describe('il verdetto, senza rotte', () => {
  it('due righe con lo stesso riferimento non tornano mai, anche se la somma e giusta', () => {
    expect(verdettoDelCredito([{ delta_cents: 2000 }, { delta_cents: 2000 }], 4000).esito).toBe('diverso');
  });
  it('senza la cifra attesa dice quanto c e scritto e lascia il confronto a chi legge', () => {
    expect(verdettoDelCredito([{ delta_cents: 4000 }], null)).toMatchObject({ esito: 'senza-atteso', scrittoCents: 4000 });
  });
});

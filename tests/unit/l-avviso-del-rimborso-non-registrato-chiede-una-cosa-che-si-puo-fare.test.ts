import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'giulia', guasto: false }));

vi.mock('@/lib/supabase/server', () => {
  const client = () => {
    const c = finto.db.client;
    return {
      ...c,
      from: (tabella: string) => {
        const q = c.from(tabella) as unknown as Record<string, (...a: unknown[]) => unknown>;
        if (tabella !== 'returns' || !finto.guasto) return q;
        const update = q.update.bind(q);
        q.update = (valori: unknown) => {
          if (valori && typeof valori === 'object' && 'refund_id' in valori) {
            const caduta: Record<string, unknown> = {};
            caduta.eq = () => caduta;
            caduta.then = (ok: (v: unknown) => unknown) =>
              Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }).then(ok);
            return caduta;
          }
          return update(valori);
        };
        return q;
      },
    };
  };
  return { getAdminSupabase: () => client(), getServerSupabase: async () => client() };
});
const stripe = vi.hoisted(() => ({ rimborsi: 0 }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => { stripe.rimborsi += 1; return { id: 're_carta_1' }; }) },
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
import { POST as comandoDellaLista } from '@/app/api/admin/rimborsi-da-bonificare/route';

/**
 * Riesame del 16/10, quinto giro — L'AVVISO CHIEDEVA A CHI AMMINISTRA UNA COSA IMPOSSIBILE.
 *
 * Giulia rende un maglione da 40 € pagato con la carta. Il negozio lo segna rimborsato: Stripe
 * restituisce i 40 €, poi la scrittura dell'esito sul reso va in timeout. Chi amministra riceve
 * «Rimborso partito ma non registrato sul reso… Scrivi sul reso il riferimento del rimborso». Ma
 * nessuna pagina del pannello scrive sui resi: l'unica rotta di chi amministra che lo fa registra
 * solo i bonifici. Il compito restava aperto per sempre.
 *
 * Adesso l'avviso dice cosa serve davvero — i soldi sono gia' usciti, il riferimento dal pannello
 * non si scrive, e se il negozio prova a rimborsare di nuovo va fermato — e la prova controlla che
 * sia vero: dal pannello il riferimento non si scrive davvero, e i soldi sono usciti una volta.
 */

const ORDINE = '11111111-1111-4111-8111-111111111111';
const RESO = '22222222-2222-4222-8222-222222222222';
type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

function maglioneConLaCarta(): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio', total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: 'pi_1', stripe_transfer_id: null, stripe_reversal_id: null, refunded_amount_cents: 0,
    payment_method: 'card', rider_id: null, rider_transfer_id: null, rider_payout_status: null,
    rider_payout_reversed_cents: 0, rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), payment_status: 'PAID',
  };
}

async function chiama(rotta: unknown, corpo: unknown, id: string) {
  const res = await (rotta as Rotta)(new Request('http://localhost/x', json(corpo)), { params: Promise.resolve({ id }) });
  return { status: res.status, corpo: await res.json() };
}

beforeEach(() => {
  finto.guasto = false;
  stripe.rimborsi = 0;
  finto.db = creaFintoDatabase({
    orders: [maglioneConLaCarta()],
    returns: [],
    order_items: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
    notifications: [],
  });
});

describe('l avviso del rimborso partito ma non registrato chiede una cosa che si puo fare', () => {
  it('IL CASO CHE ROMPEVA — carta: l avviso non chiede di scrivere sul reso, che dal pannello non si puo', async () => {
    finto.utente = 'giulia';
    const aperto = await (apriReso as unknown as Rotta)(
      new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'CHANGED_MIND' })), undefined,
    );
    expect(aperto.status).toBe(201);
    finto.db.tabelle.returns[0].id = RESO;
    finto.utente = 'negozio';
    expect((await chiama(decidi, { decision: 'APPROVED' }, RESO)).status).toBe(200);
    expect((await chiama(avanza, { stato: 'RECEIVED' }, RESO)).status).toBe(200);

    finto.guasto = true;
    const esito = await chiama(avanza, { stato: 'REFUNDED', refundAmountCents: 4000 }, RESO);
    finto.guasto = false;
    expect(esito.status, 'il guasto non e avvenuto: la prova non misura niente').not.toBe(200);
    expect(stripe.rimborsi, 'i soldi non sono usciti: la prova non misura niente').toBe(1);

    const [avviso] = notificheConTitolo(finto.db, 'non registrato sul reso');
    expect(avviso, 'nessun avviso a chi amministra').toBeTruthy();
    const testo = String(avviso.body);

    // Quello che l'avviso chiedeva di fare, dal pannello, non si fa: l'unica rotta di chi amministra
    // che scrive sui resi rifiuta questo reso.
    const dalPannello = await (comandoDellaLista as unknown as Rotta)(
      new Request('http://localhost/api/admin/rimborsi-da-bonificare', json({ resoId: RESO, azione: 'fatto' })), undefined,
    );
    expect(dalPannello.status).toBe(409);
    expect(finto.db.tabelle.returns[0].refund_id ?? null).toBeNull();
    expect(testo, 'l avviso chiede di scrivere sul reso, cosa che dal pannello non si fa').not.toMatch(/Scrivi sul reso/u);

    // Quello che chiede adesso e' vero: i soldi sono usciti una volta, e il negozio va avvisato di
    // non rimborsare di nuovo (sesto giro: «fermalo» chiedeva un blocco che dal pannello non c'e').
    expect(testo).toMatch(/già partito/u);
    expect(testo).toMatch(/rimborsarlo di nuovo/u);
  });

  it('SESTO GIRO — in «decide» il reso resta approvato: l avviso non chiede di fermare il negozio, chiede di avvisarlo', async () => {
    finto.utente = 'giulia';
    const aperto = await (apriReso as unknown as Rotta)(
      new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'CHANGED_MIND' })), undefined,
    );
    expect(aperto.status).toBe(201);
    finto.db.tabelle.returns[0].id = RESO;
    finto.utente = 'negozio';

    finto.guasto = true;
    const esito = await chiama(decidi, { decision: 'APPROVED', refundAmountCents: 4000 }, RESO);
    finto.guasto = false;
    expect(esito.status, 'il guasto non e avvenuto: la prova non misura niente').not.toBe(200);
    expect(stripe.rimborsi).toBe(1);
    // Il caso in cui la frase conta: il negozio vede ancora «Chiudi senza rimborso».
    expect(finto.db.tabelle.returns[0].status).toBe('APPROVED');

    const [avviso] = notificheConTitolo(finto.db, 'non registrato sul reso');
    const testo = String(avviso.body);
    expect(testo, 'chiede di fermare il negozio, ma dal pannello un reso non si blocca').not.toMatch(/fermal/u);
    expect(testo).toMatch(/avvisa tu il negozio/u);
    expect(testo).toMatch(/non chiuderlo senza rimborso/u);
    expect(testo).toMatch(/recapiti in Utenti/u);
  });
});


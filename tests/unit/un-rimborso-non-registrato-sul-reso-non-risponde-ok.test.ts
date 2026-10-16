import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * 16/10/2026 — IL RIMBORSO PARTIVA, LA REGISTRAZIONE CADEVA, E LA ROTTA DICEVA «OK».
 *
 * Nella tappa «rimborsato» di `avanza` i soldi escono prima (per i contanti: il bonifico si
 * registra sull'ordine), poi si scrive sul reso il segno del rimborso — ed e' quel segno che fa
 * comparire il bonifico nella lista di chi paga. Se quella scrittura cadeva, la rotta guardava
 * solo l'avviso per i log e rispondeva 200: il reso restava «rimborsato» senza segno, la lista dei
 * bonifici non lo mostrava, e il negozio leggeva «fatto». `decide`, la stessa scrittura, la
 * controllava gia'.
 *
 * Girano le rotte vere (apertura, decisione, avanzamento) e la `refundOrder` vera; il guasto e'
 * uno solo: un timeout del database proprio sulla scrittura dell'esito sul reso.
 */

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
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, handler: (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: finto.utente }, req, params: (await ctx?.params) ?? {} }),
}));

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';

const ORDINE = '11111111-1111-4111-8111-111111111111';

function maglione(): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio', total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, refunded_amount_cents: 0,
    payment_method: 'cod', rider_id: null, rider_transfer_id: null, rider_payout_status: null,
    rider_payout_reversed_cents: 0, rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), payment_status: 'PAID',
    cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(),
  };
}

const json = (corpo: unknown) => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
});

async function chiama(rotta: unknown, corpo: unknown, id: string) {
  const res = await (rotta as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/x', json(corpo)), { params: Promise.resolve({ id }) },
  );
  return { status: res.status, corpo: await res.json() };
}

/** Il reso del maglione, aperto col bonifico e arrivato fino a «merce ricevuta». */
async function resoRicevuto(): Promise<string> {
  const id = await resoAperto();
  finto.utente = 'negozio';
  expect((await chiama(decidi, { decision: 'APPROVED' }, id)).status).toBe(200);
  expect((await chiama(avanza, { stato: 'RECEIVED' }, id)).status).toBe(200);
  return id;
}

/** Il reso del maglione, appena aperto dalla cliente col bonifico e l'IBAN. */
async function resoAperto(): Promise<string> {
  finto.utente = 'giulia';
  const res = await (apriReso as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/api/returns/create', json({
      orderId: ORDINE, reason: 'CHANGED_MIND', rimborso: { modo: 'BONIFICO', iban: 'IT60X0542811101000000123456' },
    })),
    undefined,
  );
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}

beforeEach(() => {
  finto.guasto = false;
  finto.db = creaFintoDatabase({
    orders: [maglione()],
    returns: [],
    order_items: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
    notifications: [],
  });
});

describe('avanza: se l esito del rimborso non si registra sul reso, non si risponde «ok»', () => {
  it('il negozio legge che la registrazione non e riuscita, e chi paga riceve l avviso con reso e cifra', async () => {
    const id = await resoRicevuto();

    finto.guasto = true;
    const esito = await chiama(avanza, { stato: 'REFUNDED', refundAmountCents: 4000 }, id);
    finto.guasto = false;

    const reso = finto.db.tabelle.returns[0];
    expect(reso.refund_id ?? null, 'il guasto non e avvenuto: la prova non misura niente').toBeNull();
    expect(esito.status, 'il rimborso non e registrato sul reso e la rotta risponde come se fosse tutto a posto').not.toBe(200);
    expect(String(esito.corpo.error?.message)).toContain('non si è potuto registrare');

    const avvisi = notificheConTitolo(finto.db, 'non registrato sul reso');
    expect(avvisi, 'chi paga non sa che c e un bonifico fuori dalla lista').toHaveLength(1);
    const testo = String(avvisi[0].body);
    expect(testo).toContain(id);
    expect(testo).toContain('#11111111');
    expect(testo).toMatch(/40,00\s€/u);
    expect(avvisi[0].link).toBe('/admin/rimborsi-da-bonificare');
  });

  it('senza guasto resta tutto come prima: 200, e il segno del bonifico sul reso', async () => {
    const id = await resoRicevuto();
    const esito = await chiama(avanza, { stato: 'REFUNDED', refundAmountCents: 4000 }, id);
    expect(esito.status).toBe(200);
    expect(finto.db.tabelle.returns[0].refund_id).toBe(`bonifico:4000:return_${id}`);
    expect(notificheConTitolo(finto.db, 'non registrato sul reso')).toHaveLength(0);
  });
});

/**
 * Riesame del 16/10, terzo giro — LA STESSA CADUTA, SULLA DECISIONE.
 *
 * Il negozio approva il reso col rimborso subito (`decide` con l'importo): `refundOrder` registra
 * i 40 € sull'ordine e il bonifico diventa dovuto, poi cade la scrittura dell'esito sul reso. La
 * rotta rispondeva solo «Update fallito», senza nessun avviso: il reso restava «approvato» senza
 * segno, il bonifico fuori dalla lista di chi paga, e il negozio non sapeva che i soldi risultavano
 * gia' restituiti.
 */
describe('decide: se l esito del rimborso non si registra sul reso, non si risponde «ok» e chi paga lo sa', () => {
  it('il negozio legge di non ripetere il rimborso, e chi paga riceve l avviso con reso, ordine e cifra', async () => {
    const id = await resoAperto();
    finto.utente = 'negozio';

    finto.guasto = true;
    const esito = await chiama(decidi, { decision: 'APPROVED', refundAmountCents: 4000 }, id);
    finto.guasto = false;

    const reso = finto.db.tabelle.returns[0];
    expect(reso.refund_id ?? null, 'il guasto non e avvenuto: la prova non misura niente').toBeNull();
    expect(finto.db.tabelle.orders[0].refunded_amount_cents, 'il rimborso non e partito: la prova non misura niente').toBe(4000);
    expect(esito.status, 'il rimborso non e registrato sul reso e la rotta risponde come se fosse tutto a posto').not.toBe(200);
    expect(String(esito.corpo.error?.message)).toContain('Non ripetere il rimborso');

    const avvisi = notificheConTitolo(finto.db, 'non registrato sul reso');
    expect(avvisi, 'chi paga non sa che c e un bonifico fuori dalla lista').toHaveLength(1);
    const testo = String(avvisi[0].body);
    expect(testo).toContain(id);
    expect(testo).toContain('#11111111');
    expect(testo).toMatch(/40,00\s€/u);
    expect(avvisi[0].link).toBe('/admin/rimborsi-da-bonificare');
  });

  it('senza guasto resta tutto come prima: 200, il reso rimborsato col segno del bonifico, nessun avviso di guasto', async () => {
    const id = await resoAperto();
    finto.utente = 'negozio';
    const esito = await chiama(decidi, { decision: 'APPROVED', refundAmountCents: 4000 }, id);
    expect(esito.status).toBe(200);
    expect(finto.db.tabelle.returns[0].status).toBe('REFUNDED');
    expect(finto.db.tabelle.returns[0].refund_id).toBe(`bonifico:4000:return_${id}`);
    expect(notificheConTitolo(finto.db, 'non registrato sul reso')).toHaveLength(0);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';
import {
  bonificiDeiResiDagliOrdini,
  cosaDiceLaVoce,
  registrazioneMancanteDelBonifico,
  type VoceDaBonificare,
} from '@/lib/rimborsi/bonifici-da-fare';

/**
 * Riesame del 16/10, quarto giro — IL BONIFICO SPARIVA DALLA LISTA SE IL RESO NON LO SAPEVA.
 *
 * Giulia rende un maglione da 40 € pagato in contanti e sceglie il bonifico. Il negozio rimborsa:
 * `refundOrder` chiude i conti (ordine rimborsato, 36 € ripresi al negozio) e scrive il segno del
 * bonifico nell'elenco dei rimborsi dell'ordine. Poi, con una scrittura a parte, lo scrive sul
 * reso — ed e' quella che la lista dei bonifici da fare cercava. Se cadeva (un timeout del
 * database), la lista restava vuota: a chi paga rimaneva un avviso nella campanella che lo mandava
 * proprio in quella lista, dove la voce non c'era e «Fatto» non si poteva premere.
 *
 * Girano le rotte vere (apertura, decisione, avanzamento, lista dei bonifici) e la `refundOrder`
 * vera; il guasto e' uno solo: la scrittura dell'esito sul reso.
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
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, handler: (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: finto.utente }, req, params: (await ctx?.params) ?? {} }),
  withAdminAuth:
    (handler: (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: 'admin-1' }, req, params: (await ctx?.params) ?? {} }),
}));

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';
import { GET as lista, POST as comandoDellaLista } from '@/app/api/admin/rimborsi-da-bonificare/route';

const ORDINE = '11111111-1111-4111-8111-111111111111';
const IBAN = 'IT60X0542811101000000123456';
/** Il comando della lista vuole l'id di un reso vero (uuid): il finto database ne inventa uno corto. */
const RESO = '22222222-2222-4222-8222-222222222222';

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

async function resoAperto(): Promise<string> {
  finto.utente = 'giulia';
  const res = await (apriReso as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/api/returns/create', json({
      orderId: ORDINE, reason: 'CHANGED_MIND', rimborso: { modo: 'BONIFICO', iban: IBAN },
    })),
    undefined,
  );
  expect(res.status).toBe(201);
  const corto = (await res.json()).id as string;
  const riga = finto.db.tabelle.returns.find((r) => r.id === corto)!;
  riga.id = RESO;
  return RESO;
}

type Lista = { voci: VoceDaBonificare[]; daControllare?: unknown };
async function leggiLaLista(): Promise<Lista> {
  const res = await (lista as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/api/admin/rimborsi-da-bonificare'), undefined,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Lista;
}

async function segnaFatto(resoId: string) {
  const res = await (comandoDellaLista as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/api/admin/rimborsi-da-bonificare', json({ resoId, azione: 'fatto' })), undefined,
  );
  return { status: res.status, corpo: await res.json() };
}

const reso = () => finto.db.tabelle.returns[0];

beforeEach(() => {
  finto.guasto = false;
  finto.db = creaFintoDatabase({
    orders: [maglione()],
    returns: [],
    order_items: [],
    bonifici_dei_reclami: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
    notifications: [],
  });
});

describe('la scrittura sul reso cade in «decide»: il bonifico dovuto resta nella lista di chi paga', () => {
  it('la voce c e, con la cifra dell ordine e l IBAN del reso, fra quelli da pagare', async () => {
    const id = await resoAperto();
    finto.utente = 'negozio';
    finto.guasto = true;
    expect((await chiama(decidi, { decision: 'APPROVED', refundAmountCents: 4000 }, id)).status).not.toBe(200);
    finto.guasto = false;
    expect(reso().refund_id ?? null, 'il guasto non e avvenuto: la prova non misura niente').toBeNull();
    expect(finto.db.tabelle.orders[0]).toMatchObject({ refunded_amount_cents: 4000, payment_status: 'REFUNDED' });

    const { voci, daControllare } = await leggiLaLista();
    expect(voci, 'il bonifico dovuto e sparito dalla lista').toHaveLength(1);
    expect(voci[0]).toMatchObject({
      tipo: 'reso', id, ordineId: ORDINE, importoCents: 4000, daFare: true, daRegistrareSulReso: true,
    });
    expect(String(voci[0].iban).replace(/\s/g, '')).toBe(IBAN);
    // Sesto giro: la lista ha un elenco solo, niente «da controllare».
    expect(daControllare).toBeUndefined();
    expect(cosaDiceLaVoce(voci[0], true).sulReso).toMatch(/registriamo anche sul reso/u);

    // L'avviso manda alla lista dicendo che la voce c'e', non che non c'e'.
    const avviso = notificheConTitolo(finto.db, 'non registrato sul reso')[0];
    expect(String(avviso.body)).toContain('lo trovi nella lista');
    expect(String(avviso.body)).not.toContain('NON compare');
  });

  it('«Bonifico fatto» registra il rimborso sul reso, cancella l IBAN e la voce passa fra i fatti', async () => {
    const id = await resoAperto();
    finto.utente = 'negozio';
    finto.guasto = true;
    await chiama(decidi, { decision: 'APPROVED', refundAmountCents: 4000 }, id);
    finto.guasto = false;

    const fatto = await segnaFatto(id);
    expect(fatto.status, `«Fatto» non si puo premere sulla voce: ${JSON.stringify(fatto.corpo)}`).toBe(200);
    expect(reso()).toMatchObject({ status: 'REFUNDED', refund_id: `bonifico:4000:return_${id}`, refund_bonifico_cents: 4000, refund_iban: null });
    expect(reso().refund_bonifico_fatto_at).toBeTruthy();
    expect(finto.db.tabelle.orders[0].refunded_amount_cents, 'il rimborso e stato rifatto').toBe(4000);

    const { voci } = await leggiLaLista();
    expect(voci).toHaveLength(1);
    expect(voci[0]).toMatchObject({ id, daFare: false });
    expect(voci[0].daRegistrareSulReso).toBeUndefined();
  });
});

describe('la scrittura sul reso cade in «avanza»: il reso e rimborsato, il segno no', () => {
  it('la voce c e lo stesso, e «Fatto» la chiude', async () => {
    const id = await resoAperto();
    finto.utente = 'negozio';
    expect((await chiama(decidi, { decision: 'APPROVED' }, id)).status).toBe(200);
    expect((await chiama(avanza, { stato: 'RECEIVED' }, id)).status).toBe(200);
    finto.guasto = true;
    expect((await chiama(avanza, { stato: 'REFUNDED', refundAmountCents: 4000 }, id)).status).not.toBe(200);
    finto.guasto = false;
    expect(reso()).toMatchObject({ status: 'REFUNDED' });
    expect(reso().refund_id ?? null).toBeNull();

    const { voci } = await leggiLaLista();
    expect(voci, 'il bonifico dovuto e sparito dalla lista').toHaveLength(1);
    expect(voci[0]).toMatchObject({ id, importoCents: 4000, daFare: true });

    expect((await segnaFatto(id)).status).toBe(200);
    expect(reso()).toMatchObject({ refund_id: `bonifico:4000:return_${id}`, refund_iban: null });
  });
});

describe('quello che la lista NON deve prendere dall ordine', () => {
  it('un reso approvato senza rimborso partito non e un bonifico, e «Fatto» non lo tocca', async () => {
    const id = await resoAperto();
    finto.utente = 'negozio';
    expect((await chiama(decidi, { decision: 'APPROVED' }, id)).status).toBe(200);

    expect((await leggiLaLista()).voci).toHaveLength(0);
    expect((await segnaFatto(id)).status).toBe(409);
    expect(reso()).toMatchObject({ status: 'APPROVED', refund_iban: IBAN });
    expect(reso().refund_id ?? null).toBeNull();
  });

  it('il segno di un altro reso sullo stesso ordine non fa comparire questo', () => {
    const ordine = { id: ORDINE, stripe_refund_id: 'bonifico:4000:return_altro' };
    const r = { id: 'questo', order_id: ORDINE, status: 'APPROVED', refund_id: null, refund_amount_cents: 4000, refunded_at: null };
    expect(registrazioneMancanteDelBonifico(r, ordine)).toBeNull();
    // Sesto giro: la lista nasce dai segni sull'ordine. Questo reso non ha segno: non c'e'.
    expect(bonificiDeiResiDagliOrdini([ordine], [r]).map((x) => x.id)).toEqual(['altro']);
    // Un reso che il segno ce l'ha anche sulla riga conta una volta sola.
    const conSegno = { ...r, id: 'altro', refund_id: 'bonifico:4000:return_altro', status: 'REFUNDED' };
    expect(bonificiDeiResiDagliOrdini([ordine, ordine], [conSegno])).toHaveLength(1);
    // Un reso chiuso senza rimborso non si resuscita.
    expect(registrazioneMancanteDelBonifico({ ...r, id: 'altro', status: 'CANCELED' }, ordine)).toBeNull();
  });
});

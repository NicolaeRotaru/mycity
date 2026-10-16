import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * 16/10/2026 — L'IBAN CHE IL CLIENTE CI LASCIA PER IL RIMBORSO RESTAVA PER SEMPRE.
 *
 * Giulia paga in contanti un maglione da 40 €, lo restituisce e scrive il suo IBAN nel modulo di
 * reso. Prima di questa correzione l'IBAN restava sul reso:
 *  · dopo il bonifico — la rotta che segna «fatto» scriveva solo la data;
 *  · dopo un reso respinto — il bonifico non sarebbe partito mai;
 *  · dopo che Giulia aveva cancellato l'account — la riga del reso sopravvive (buyer_id va a NULL)
 *    e la pulizia azzerava solo le note. Il conto restava in chiaro, legato all'ordine, mentre
 *    l'informativa diceva «usato solo per quel bonifico» e le impostazioni «quella riga non porta
 *    piu' il tuo nome».
 *
 * E sul reclamo il contrario: cancellato l'account prima del bonifico, la riga «24 € da fare»
 * restava, ma nel database non c'era piu' niente che dicesse a chi pagarli.
 *
 * LA REGOLA (decisa dall'AD, che Nicola e il legale possono cambiare): l'IBAN si tiene SOLO
 * finche' il bonifico e' da fare. Fatto il bonifico, si cancella. Se il cliente cancella l'account
 * con un bonifico ancora da fare, sul reso o sul reclamo restano solo IBAN e nome
 * dell'intestatario fino al pagamento; senza bonifici da fare, l'IBAN se ne va con l'account.
 *
 * Girano le rotte VERE (apertura del reso, decisione, avanzamento, lista dei bonifici) e la
 * cancellazione dell'account VERA; finti solo il database, Stripe e la posta. Si guarda la riga
 * del reso alla fine, non cosa il codice ha chiesto di scrivere.
 */

const finto = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  utente: 'giulia',
  /** Account chiusi da `deleteUser`. */
  cancellati: [] as string[],
  /** La lettura dei resi della persona cade (per la cancellazione dell'account). */
  resiIlleggibili: false,
}));

vi.mock('@/lib/supabase/server', () => {
  const client = () => {
    const c = finto.db.client;
    return {
      ...c,
      from: (tabella: string) => {
        if (tabella === 'returns' && finto.resiIlleggibili) {
          const caduta = { code: '57014', message: 'canceling statement due to statement timeout' };
          const q: Record<string, unknown> = {};
          for (const m of ['select', 'eq', 'is', 'in', 'like', 'order', 'limit', 'update', 'maybeSingle']) q[m] = () => q;
          q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: caduta }).then(ok);
          return q;
        }
        return c.from(tabella);
      },
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: { email: 'giulia@test.it' } } }),
          // Fa quello che fa il database vero: resi e ordini restano senza la persona (SET NULL),
          // reclami e profilo se ne vanno con lei (CASCADE).
          deleteUser: async (id: string) => {
            finto.cancellati.push(id);
            const t = finto.db.tabelle;
            for (const r of t.returns ?? []) if (r.buyer_id === id) r.buyer_id = null;
            for (const o of t.orders ?? []) if (o.user_id === id) o.user_id = null;
            t.disputes = (t.disputes ?? []).filter((d) => d.opener_id !== id);
            t.profiles = (t.profiles ?? []).filter((p) => p.id !== id);
            return { error: null };
          },
        },
      },
      storage: {
        from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ error: null }) }),
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
    customers: { del: vi.fn(async () => ({})) },
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
    async (req: Request) => handler({ user: { id: 'admin-1' }, req, params: {} }),
}));

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';
import { GET as lista, POST as comandoSullaLista } from '@/app/api/admin/rimborsi-da-bonificare/route';
import { cancellaAccount } from '@/lib/account/cancellazione';
import { getAdminSupabase } from '@/lib/supabase/server';
import { ilBonificoDelResoEAncoraDaFare } from '@/lib/rimborsi/iban-del-rimborso';

const ORDINE = '11111111-1111-4111-8111-111111111111';
const ORDINE_FIORI = '11111111-1111-4111-8111-222222222222';
const RECLAMO = '44444444-4444-4444-8444-444444444444';
const IBAN = 'IT60X0542811101000000123456';
const IBAN_DI_MARCO = 'IT42L1234512345123456789012';

function ordineInContanti(id: string, extra: Riga = {}): Riga {
  return {
    id, user_id: 'giulia', seller_id: 'negozio', total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, refunded_amount_cents: 0,
    payment_method: 'cod', rider_id: null, rider_transfer_id: null, rider_payout_status: null,
    rider_payout_reversed_cents: 0, rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), payment_status: 'PAID',
    cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(),
    delivery_full_name: 'Giulia Bianchi', delivery_phone: '3331234567', delivery_address: 'Via Roma 1',
    ...extra,
  };
}

beforeEach(() => {
  finto.utente = 'giulia';
  finto.cancellati = [];
  finto.resiIlleggibili = false;
  finto.db = creaFintoDatabase({
    orders: [ordineInContanti(ORDINE)],
    returns: [],
    order_items: [],
    disputes: [],
    bonifici_dei_reclami: [],
    cod_reconciliations: [],
    profiles: [
      { id: 'admin-1', role: 'admin' },
      { id: 'negozio', role: 'seller' },
      { id: 'giulia', role: 'buyer', full_name: 'Giulia B.' },
    ],
    notifications: [],
  });
});

// ── le mosse, come le fanno le persone ──────────────────────────────────────

const json = (corpo: unknown) => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
});

async function chiama(rotta: unknown, corpo: unknown, id: string) {
  const res = await (rotta as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/x', json(corpo)), { params: Promise.resolve({ id }) },
  );
  return { status: res.status, corpo: await res.json() };
}

let progressivo = 0;

/** Giulia apre il reso col bonifico e il suo IBAN. */
async function apriIlReso(motivo = 'CHANGED_MIND'): Promise<string> {
  finto.utente = 'giulia';
  const res = await (apriReso as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/api/returns/create', json({
      orderId: ORDINE, reason: motivo, rimborso: { modo: 'BONIFICO', iban: IBAN },
    })),
    undefined,
  );
  expect(res.status, 'il reso non si e aperto: la prova non misura niente').toBe(201);
  // Il finto database da' agli inserimenti un nome qualsiasi; la lista dei bonifici vuole un
  // identificativo vero, come quelli che da' il database.
  const provvisorio = (await res.json()).id as string;
  const id = `55555555-5555-4555-8555-${String(++progressivo).padStart(12, '0')}`;
  reso(provvisorio).id = id;
  return id;
}

async function negozio(rotta: unknown, corpo: unknown, id: string) {
  finto.utente = 'negozio';
  const esito = await chiama(rotta, corpo, id);
  expect(esito.status, `il negozio non e riuscito: ${JSON.stringify(esito.corpo)}`).toBe(200);
}

/** Il reso fino al rimborso: da qui il bonifico e' da fare. */
async function resoRimborsato(): Promise<string> {
  const id = await apriIlReso();
  await negozio(decidi, { decision: 'APPROVED' }, id);
  await negozio(avanza, { stato: 'RECEIVED' }, id);
  await negozio(avanza, { stato: 'REFUNDED', refundAmountCents: 4000 }, id);
  return id;
}

async function voci() {
  const res = await (lista as unknown as (r: Request) => Promise<Response>)(new Request('http://localhost/lista'));
  return (await res.json()).voci as Array<Record<string, unknown>>;
}

async function suLaLista(corpo: Record<string, unknown>) {
  const res = await (comandoSullaLista as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/admin/rimborsi-da-bonificare', json(corpo)),
  );
  return { status: res.status, corpo: await res.json() };
}

const reso = (id: string) => finto.db.tabelle.returns.find((r) => r.id === id)!;

// ── le prove ─────────────────────────────────────────────────────────────────

describe('la regola, da sola', () => {
  it.each([
    ['rimborsato col bonifico, non ancora fatto', { status: 'REFUNDED', refund_id: 'bonifico:4000:return_r1' }, true],
    ['rimborsato col bonifico, gia fatto', { status: 'REFUNDED', refund_id: 'bonifico:4000:return_r1', refund_bonifico_fatto_at: '2026-10-16T09:00:00Z' }, false],
    ['rimborsato col credito', { status: 'REFUNDED', refund_id: 'wallet:return_r1' }, false],
    ['rimborsato sulla carta', { status: 'REFUNDED', refund_id: 're_123' }, false],
    ['in corso, col bonifico scelto', { status: 'RECEIVED', refund_method: 'BONIFICO' }, true],
    ['in corso, col credito scelto', { status: 'APPROVED', refund_method: 'CREDITO' }, false],
    ['respinto', { status: 'REJECTED', refund_method: 'BONIFICO' }, false],
    ['annullato', { status: 'CANCELED', refund_method: 'BONIFICO' }, false],
  ])('%s', (_nome, riga, atteso) => {
    expect(ilBonificoDelResoEAncoraDaFare(riga)).toBe(atteso);
  });
});

describe('finche il reso e in corso, l IBAN resta', () => {
  it('approvato e ricevuto: il bonifico arrivera, il conto serve', async () => {
    const id = await apriIlReso();
    await negozio(decidi, { decision: 'APPROVED' }, id);
    await negozio(avanza, { stato: 'RECEIVED' }, id);
    expect(reso(id).refund_iban).toBe(IBAN);
  });
});

describe('fatto il bonifico, l IBAN se ne va', () => {
  it('«Bonifico fatto» cancella l IBAN dal reso, e la lista non lo mostra piu', async () => {
    const id = await resoRimborsato();
    expect(reso(id).refund_iban, 'prima del bonifico il conto deve esserci, se no non si paga').toBe(IBAN);
    expect((await voci()).find((v) => v.id === id)).toMatchObject({ daFare: true, iban: 'IT60 X054 2811 1010 0000 0123 456' });

    expect((await suLaLista({ resoId: id })).status).toBe(200);

    expect(reso(id).refund_bonifico_fatto_at).toBeTruthy();
    expect(reso(id).refund_iban, 'il bonifico e fatto e l IBAN della cliente resta sul reso per sempre').toBeNull();
    expect((await voci()).find((v) => v.id === id)).toMatchObject({ daFare: false, iban: null });
  });
});

describe('un reso chiuso senza bonifico non tiene l IBAN', () => {
  it('respinto dal negozio: il bonifico non partira mai', async () => {
    // Il recesso entro 14 giorni non si respinge: si respinge un reso per un difetto non provato.
    const id = await apriIlReso('NOT_AS_DESCRIBED');
    expect(reso(id).refund_iban).toBe(IBAN);
    await negozio(decidi, { decision: 'REJECTED' }, id);
    expect(reso(id).status).toBe('REJECTED');
    expect(reso(id).refund_iban, 'reso respinto, e il conto della cliente resta li per sempre').toBeNull();
  });

  it('annullato dopo l approvazione: lo stesso', async () => {
    const id = await apriIlReso();
    await negozio(decidi, { decision: 'APPROVED' }, id);
    await negozio(avanza, { stato: 'CANCELED' }, id);
    expect(reso(id).refund_iban).toBeNull();
  });
});

describe('la cliente cancella l account', () => {
  it('con un bonifico ancora da fare: restano solo l IBAN e il nome, fino al pagamento', async () => {
    const id = await resoRimborsato();
    reso(id).notes = 'il maglione era della taglia sbagliata';

    const esito = await cancellaAccount(getAdminSupabase(), 'giulia');
    expect(esito.ok, esito.errore).toBe(true);

    const r = reso(id);
    expect(r.buyer_id).toBeNull();
    expect(r.refund_iban, 'le dobbiamo ancora 40 € e il suo conto e sparito: il bonifico non si fa piu').toBe(IBAN);
    expect(r.refund_intestatario, 'resta un debito senza nessun nome a cui intestarlo').toBe('Giulia Bianchi');
    expect(r.notes, 'sul reso doveva restare SOLO il conto e il nome').toBeNull();
    // Il nome e' stato preso prima che la pulizia lo togliesse dall'ordine.
    expect(finto.db.tabelle.orders[0].delivery_full_name).toBeNull();

    // Chi paga vede a chi intestare il bonifico.
    expect((await voci()).find((v) => v.id === id)).toMatchObject({ daFare: true, intestatario: 'Giulia Bianchi' });

    // Fatto il bonifico, se ne vanno anche quelli.
    expect((await suLaLista({ resoId: id })).status).toBe(200);
    expect(reso(id).refund_iban).toBeNull();
    expect(reso(id).refund_intestatario, 'pagato il bonifico, il nome resta lo stesso').toBeNull();
  });

  it('senza bonifici da fare: l IBAN se ne va insieme all account', async () => {
    // Due resi di prima di questa correzione, quando l'IBAN non se ne andava mai: uno respinto,
    // uno rimborsato col credito. Nessun bonifico da fare.
    finto.db.tabelle.returns.push(
      { id: 'r-respinto', order_id: ORDINE, buyer_id: 'giulia', status: 'REJECTED', refund_method: 'BONIFICO',
        refund_iban: IBAN, refund_id: null, refund_bonifico_fatto_at: null, notes: null },
      { id: 'r-credito', order_id: ORDINE, buyer_id: 'giulia', status: 'REFUNDED', refund_method: 'BONIFICO',
        refund_iban: IBAN, refund_id: 'wallet:return_r-credito', refund_bonifico_fatto_at: null, notes: null },
    );

    const esito = await cancellaAccount(getAdminSupabase(), 'giulia');
    expect(esito.ok, esito.errore).toBe(true);

    for (const r of finto.db.tabelle.returns) {
      expect(r.refund_iban, `il reso ${r.id} tiene l IBAN di chi ha cancellato l account`).toBeNull();
      expect(r.refund_intestatario ?? null, `il reso ${r.id} tiene il nome senza nessun debito`).toBeNull();
    }
  });

  it('se i bonifici da fare non si leggono, l account non si cancella: si riprova', async () => {
    const id = await resoRimborsato();
    finto.resiIlleggibili = true;
    const esito = await cancellaAccount(getAdminSupabase(), 'giulia');
    finto.resiIlleggibili = false;

    expect(esito.ok).toBe(false);
    expect(finto.cancellati, 'account cancellato senza aver messo al sicuro il bonifico che le dobbiamo').toEqual([]);
    expect(reso(id).refund_iban).toBe(IBAN);
  });
});

describe('il bonifico di un reclamo dice a chi pagare', () => {
  beforeEach(() => {
    finto.db.tabelle.orders.push(ordineInContanti(ORDINE_FIORI, { total_price: 24, gross_total_cents: 2400 }));
    finto.db.tabelle.disputes.push({ id: RECLAMO, order_id: ORDINE_FIORI, opener_id: 'giulia', status: 'resolved_buyer' });
    finto.db.tabelle.bonifici_dei_reclami.push({
      dispute_id: RECLAMO, order_id: ORDINE_FIORI, importo_cents: 2400,
      registrato_at: '2026-10-15T09:00:00Z', fatto_at: null, iban: null, intestatario: null,
    });
  });

  const bonifico = () => finto.db.tabelle.bonifici_dei_reclami[0];

  it('chi paga copia l IBAN arrivato dai Contatti: uno storto non entra', async () => {
    const storto = await suLaLista({ reclamoId: RECLAMO, azione: 'iban', iban: 'IT60 X054 2811' });
    expect(storto.status).toBe(400);
    expect(bonifico().iban).toBeNull();

    expect((await suLaLista({ reclamoId: RECLAMO, azione: 'iban', iban: 'it42 l123 4512 3451 2345 6789 012' })).status).toBe(200);
    expect(bonifico().iban).toBe(IBAN_DI_MARCO);
    expect((await voci()).find((v) => v.id === RECLAMO)).toMatchObject({ iban: 'IT42 L123 4512 3451 2345 6789 012' });
  });

  it('se la cliente cancella l account prima del bonifico, sulla riga restano IBAN e nome; pagato, se ne vanno', async () => {
    await suLaLista({ reclamoId: RECLAMO, azione: 'iban', iban: IBAN_DI_MARCO });

    const esito = await cancellaAccount(getAdminSupabase(), 'giulia');
    expect(esito.ok, esito.errore).toBe(true);
    expect(finto.db.tabelle.disputes, 'il reclamo se ne va con la cliente').toHaveLength(0);

    expect(bonifico()).toMatchObject({ fatto_at: null, iban: IBAN_DI_MARCO, intestatario: 'Giulia Bianchi' });
    expect((await voci()).find((v) => v.id === RECLAMO)).toMatchObject({ daFare: true, intestatario: 'Giulia Bianchi' });

    expect((await suLaLista({ reclamoId: RECLAMO })).status).toBe(200);
    expect(bonifico().fatto_at).toBeTruthy();
    expect(bonifico().iban).toBeNull();
    expect(bonifico().intestatario).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, creditoDi, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * R71 — IL MODULO DI RESO CHIEDE COME RIAVERE I CONTANTI, E LA RISPOSTA ARRIVA
 * FINO AI SOLDI.
 *
 * Prima il modulo di reso non chiedeva niente e la tabella dei resi non aveva
 * dove scrivere una risposta: il rimborso di un ordine in contanti era credito
 * MyCity d'ufficio. Qui si apre un reso dalla rotta VERA con la scelta del
 * cliente, poi il negozio lo approva dalla rotta VERA, e si guarda dove vanno i
 * soldi — con la `refundOrder` VERA. Finti solo il database, l'autenticazione,
 * Stripe e la posta.
 *
 * E la variante scomoda: la migrazione 162 non ancora applicata in produzione.
 * Il reso si deve aprire lo stesso, dirlo, e il rimborso non deve mai diventare
 * credito senza una scelta letta.
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
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: finto.utente }, req, params: (await ctx?.params) ?? {} }),
}));

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';

const ORDINE = '11111111-1111-4111-8111-111111111111';
const IBAN = 'IT60X0542811101000000123456';

/** Il maglione di Giulia: 40 € pagati al fattorino, consegnato ieri. */
function maglione(extra: Riga = {}): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio',
    total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    payment_status: 'PAID', cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(),
    ...extra,
  };
}

function apri(ordine: Riga, colonneMancanti: string[] = []) {
  finto.db = creaFintoDatabase(
    {
      orders: [ordine],
      returns: [],
      order_items: [],
      profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
      notifications: [],
    },
    { colonneMancanti },
  );
}

async function chiediReso(rimborso?: unknown) {
  finto.utente = 'giulia';
  const res = await apriReso(
    new Request('http://localhost/api/returns/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: ORDINE, reason: 'CHANGED_MIND', ...(rimborso ? { rimborso } : {}) }),
    }) as never,
    undefined as never,
  );
  return { status: res.status, corpo: await res.json() };
}

async function ilNegozioApprova(resoId: string) {
  finto.utente = 'negozio';
  const res = await decidi(
    new Request(`http://localhost/api/returns/${resoId}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'APPROVED', refundAmountCents: 4000 }),
    }) as never,
    { params: Promise.resolve({ id: resoId }) } as never,
  );
  return { status: res.status, corpo: await res.json() };
}

const reso = () => finto.db.tabelle.returns[0];
const CON_162 = ['refund_method', 'refund_iban', 'refund_bonifico_cents', 'refund_bonifico_fatto_at'];

beforeEach(() => apri(maglione()));

describe('la scelta del cliente si salva sul reso', () => {
  it('bonifico con l IBAN: salvato pulito, sul reso', async () => {
    const { status, corpo } = await chiediReso({ modo: 'BONIFICO', iban: 'it60 x054 2811 1010 0000 0123 456' });

    expect(status).toBe(201);
    expect(corpo.sceltaDelRimborso).toBe('salvata');
    expect(reso()).toMatchObject({ refund_method: 'BONIFICO', refund_iban: IBAN });
  });

  it('un IBAN sbagliato si corregge prima: il reso non si apre con un conto che non esiste', async () => {
    const { status, corpo } = await chiediReso({ modo: 'BONIFICO', iban: 'IT60X0542811101000000123457' });

    expect(status).toBe(400);
    expect(corpo.error.message).toContain('IBAN');
    expect(finto.db.tabelle.returns).toHaveLength(0);
  });

  it('credito: e la scelta espressa, e l IBAN non c e', async () => {
    await chiediReso({ modo: 'CREDITO', iban: IBAN });
    expect(reso()).toMatchObject({ refund_method: 'CREDITO', refund_iban: null });
  });

  it('ordine pagato con carta: non si sceglie niente, non si salva niente', async () => {
    apri(maglione({ stripe_payment_intent: 'pi_1', payment_method: 'card' }));
    await chiediReso({ modo: 'CREDITO' });
    expect(reso().refund_method).toBeUndefined();
  });
});

describe('la scelta arriva fino ai soldi', () => {
  it('ha scelto il bonifico: approvato il reso, nessun credito, bonifico da fare con la cifra sul reso', async () => {
    const { corpo } = await chiediReso({ modo: 'BONIFICO', iban: IBAN });
    const esito = await ilNegozioApprova(corpo.id);

    expect(esito.status).toBe(200);
    expect(creditoDi(finto.db, 'giulia')).toBe(0);
    expect(reso()).toMatchObject({ status: 'REFUNDED', refund_id: `bonifico:return_${corpo.id}`, refund_bonifico_cents: 4000 });
    const [avviso] = notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');
    expect(String(avviso.body)).toContain("L'IBAN che ha indicato");
  });

  it('ha scelto il credito: approvato il reso, il credito arriva subito', async () => {
    const { corpo } = await chiediReso({ modo: 'CREDITO' });
    await ilNegozioApprova(corpo.id);

    expect(creditoDi(finto.db, 'giulia')).toBe(4000);
    expect(reso()).toMatchObject({ status: 'REFUNDED', refund_id: `wallet:return_${corpo.id}` });
  });
});

describe('la migrazione 162 non e ancora applicata (la variante scomoda)', () => {
  it('il reso si apre lo stesso, e la pagina sa che la scelta non e rimasta scritta', async () => {
    apri(maglione(), CON_162);

    const { status, corpo } = await chiediReso({ modo: 'CREDITO' });

    expect(status, 'il recesso si blocca per una colonna che manca').toBe(201);
    expect(corpo.sceltaDelRimborso).toBe('non_salvata');
    expect(reso()).toMatchObject({ status: 'REQUESTED', order_id: ORDINE });
  });

  it('e al rimborso vale il bonifico: senza una scelta letta, mai credito', async () => {
    apri(maglione(), CON_162);
    const { corpo } = await chiediReso({ modo: 'CREDITO' });

    const esito = await ilNegozioApprova(corpo.id);

    expect(esito.status, JSON.stringify(esito.corpo)).toBe(200);
    expect(creditoDi(finto.db, 'giulia')).toBe(0);
    expect(reso()).toMatchObject({ status: 'REFUNDED', refund_id: `bonifico:return_${corpo.id}` });
    expect(notificheConTitolo(finto.db, 'Bonifico di rimborso da fare')).toHaveLength(1);
  });
});

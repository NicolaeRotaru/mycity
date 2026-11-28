import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 28/11/2026 (R08-001, onda 2) — L'ANNULLO CHE FALLISCE LASCIA UNA RIGA NEL REGISTRO.
 *
 * Il rifiuto del negozio e il «cliente assente» del fattorino passano da `annullaERimborsa`. Quando la
 * scrittura dell'annullo cade (`ANNULLAMENTO_FALLITO`: il database non risponde, un permesso revocato)
 * le due rotte rispondevano 500 e basta: nessuna riga nel registro, il guasto restava nella risposta a
 * chi aveva toccato il pulsante. L'annullo del cliente e quello dell'amministrazione la scrivono già;
 * qui si prova che la scrivono tutte e quattro le strade, col motivo e il dettaglio.
 */

const ORDINE = '11111111-2222-4333-8444-555555555555';
const NEGOZIO = 'negozio-1';
const FATTORINO = 'fattorino-1';
const CLIENTE = 'cliente-1';
const AMMINISTRATORE = 'admin-1';

const finti = vi.hoisted(() => ({
  utente: { id: '' },
  profilo: { role: 'buyer', is_approved: true } as { role: string; is_approved: boolean },
  ordine: {} as Record<string, unknown>,
  errore: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: finti.errore, warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => {
  const involucro =
    (_o: unknown, h: (c: Record<string, unknown>) => unknown) =>
    (req: unknown, ctx: { params: Record<string, string> }) =>
      h({ req, user: finti.utente, profile: finti.profilo, params: ctx.params });
  return { withAuthRateLimit: involucro, withAdminAuth: (h: (c: Record<string, unknown>) => unknown) => involucro(null, h) };
});
vi.mock('@/lib/ordini/annulla', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  annullaERimborsa: vi.fn(async () => ({ ok: false, motivo: 'ANNULLAMENTO_FALLITO', dettaglio: 'permission denied for table orders' })),
}));
vi.mock('@/lib/supabase/server', () => {
  const catena = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit']) c[m] = () => c;
    c.maybeSingle = async () => ({ data: { ...finti.ordine }, error: null });
    c.single = async () => ({ data: { ...finti.ordine }, error: null });
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return c;
  };
  const client = { from: () => catena(), rpc: async () => ({ data: null, error: null }) };
  return { getAdminSupabase: () => client, getServerSupabase: async () => client };
});

const richiesta = (url: string, corpo: unknown = {}) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

async function chiama(modulo: Promise<{ POST: unknown }>, url: string, corpo?: unknown) {
  const { POST } = await modulo;
  const res = await (POST as (req: unknown, ctx: unknown) => Promise<Response>)(richiesta(url, corpo), {
    // I pezzi dell'indirizzo li risolve l'involucro vero: al gestore arrivano già pronti.
    params: { id: ORDINE },
  });
  return res.status;
}

/** La riga d'errore che nomina l'ordine e il motivo vero dell'annullo caduto. */
const rigaDelGuasto = () =>
  finti.errore.mock.calls.find(
    ([, ctx]) =>
      (ctx as Record<string, unknown> | undefined)?.orderId === ORDINE &&
      (ctx as Record<string, unknown> | undefined)?.motivo === 'ANNULLAMENTO_FALLITO',
  );

beforeEach(() => {
  finti.errore.mockClear();
});

describe('R08-001 · l’annullo che fallisce scrive una riga nel registro', () => {
  it('il rifiuto del negozio: 500 e una riga col motivo', async () => {
    finti.utente = { id: NEGOZIO };
    finti.profilo = { role: 'seller', is_approved: true };
    finti.ordine = { id: ORDINE, user_id: CLIENTE, seller_id: NEGOZIO, delivery_status: 'NEW', payment_method: 'cod', payment_status: 'PENDING' };
    const stato = await chiama(import('@/app/api/seller/orders/[id]/reject/route'), `http://localhost/api/seller/orders/${ORDINE}/reject`, { reason: 'finito il pane' });
    expect(stato).toBe(500);
    const riga = rigaDelGuasto();
    expect(riga, 'il rifiuto è caduto con un 500 e nel registro non c’è niente').toBeDefined();
    expect((riga?.[1] as Record<string, unknown>).dettaglio).toBe('permission denied for table orders');
  });

  it('il cliente assente: 500 e una riga col motivo', async () => {
    finti.utente = { id: FATTORINO };
    finti.profilo = { role: 'rider', is_approved: true };
    finti.ordine = { id: ORDINE, user_id: CLIENTE, seller_id: NEGOZIO, rider_id: FATTORINO, delivery_status: 'OUT_FOR_DELIVERY', payment_method: 'cod', payment_status: 'PENDING' };
    const stato = await chiama(import('@/app/api/rider/orders/[id]/cliente-assente/route'), `http://localhost/api/rider/orders/${ORDINE}/cliente-assente`);
    expect(stato).toBe(500);
    const riga = rigaDelGuasto();
    expect(riga, 'il cliente assente è caduto con un 500 e nel registro non c’è niente').toBeDefined();
    expect((riga?.[1] as Record<string, unknown>).dettaglio).toBe('permission denied for table orders');
  });

  it('l’annullo del cliente dal sito (già prima): 500 e una riga col motivo', async () => {
    finti.utente = { id: CLIENTE };
    finti.profilo = { role: 'buyer', is_approved: true };
    finti.ordine = { id: ORDINE, user_id: CLIENTE, seller_id: NEGOZIO, delivery_status: 'NEW', payment_method: 'cod', payment_status: 'PENDING' };
    const stato = await chiama(import('@/app/api/orders/[id]/cancel/route'), `http://localhost/api/orders/${ORDINE}/cancel`);
    expect(stato).toBe(500);
    expect(rigaDelGuasto()).toBeDefined();
  });

  it('l’annullo dell’amministrazione (già prima): 500 e una riga col motivo', async () => {
    finti.utente = { id: AMMINISTRATORE };
    finti.profilo = { role: 'admin', is_approved: true };
    finti.ordine = { id: ORDINE, user_id: CLIENTE, seller_id: NEGOZIO, delivery_status: 'NEW', payment_method: 'cod', payment_status: 'PENDING' };
    const stato = await chiama(import('@/app/api/admin/orders/[id]/cancel/route'), `http://localhost/api/admin/orders/${ORDINE}/cancel`, { reason: 'prova' });
    expect(stato).toBe(500);
    expect(rigaDelGuasto()).toBeDefined();
  });
});

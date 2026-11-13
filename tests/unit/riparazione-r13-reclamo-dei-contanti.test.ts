import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * R13-007 — Un ordine in contanti già pagato, annullato, si rimborsa dal reclamo: il reclamo con la
 * cifra lo apre il sito (decisione di Nicola del 29/10, `pagamenti.rimborso-contanti`).
 *
 * Il caso: sabato alle 18:40 il fattorino incassa 24 € da Anna per il pane di Pane Quotidiano;
 * Anna telefona, vuole i soldi. Nicola preme «Annulla». Prima leggeva «apri un reclamo», che dal
 * pannello non si può (il database accetta il reclamo solo dal cliente o dal negozio), e i 24 €
 * restavano fermi finché Anna non lo apriva da sola.
 *
 * Girano le rotte VERE con `annullaERimborsa` VERA su un database finto.
 */

const stato: { db: FintoDatabase } = { db: fintoDatabase() };
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => { throw new Error('niente Stripe qui'); } }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: unknown) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      h({ req, user: { id: 'nicola' }, profile: { role: 'admin' }, params: (await ctx?.params) ?? {} }),
  withAuthRateLimit:
    (_o: unknown, h: (ctx: unknown) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      h({ req, user: { id: 'anna' }, params: (await ctx?.params) ?? {} }),
}));

import { POST as annullaDalPannello } from '@/app/api/admin/orders/[id]/cancel/route';
import { POST as annullaDalCliente } from '@/app/api/orders/[id]/cancel/route';
import { annullaERimborsa, type OrdineDaAnnullare } from '@/lib/ordini/annulla';
import { friendlyError } from '@/lib/errors';

type Risposta = { status: number; messaggio: string; dettagli: { reclamoId?: string; link?: string } | undefined };

async function premi(rotta: unknown, id: string): Promise<Risposta> {
  const res = await (rotta as (req: Request, ctx: unknown) => Promise<Response>)(
    new Request(`http://x/api/orders/${id}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'pane sbagliato' }),
    }),
    { params: Promise.resolve({ id }) },
  );
  const data = (await res.json()) as { error?: { message?: string; details?: Risposta['dettagli'] } };
  return { status: res.status, messaggio: data.error?.message ?? '', dettagli: data.error?.details };
}

function ordine(extra: Riga): Riga {
  return {
    user_id: 'anna', seller_id: 'pane-quotidiano', rider_id: 'rider1', payment_method: 'cod', payment_status: 'PAID',
    delivery_status: 'DELIVERED', stripe_payment_intent: null, stripe_session_id: null, wallet_applied_cents: 0,
    cash_confirmed_at: '2026-11-07T17:40:00Z', refunded_amount_cents: 0, coupon_code: null, internal_dispute_status: null,
    total_price: 24,
    ...extra,
  };
}

const reclami = () => stato.db.tabelle.disputes ?? [];
const avvisiDelReclamo = () =>
  (stato.db.tabelle.notifications ?? []).filter((n) => String(n.title ?? '').includes('Reclamo aperto dal sito'));

beforeEach(() => {
  stato.db = fintoDatabase({
    orders: [
      ordine({ id: 'pane-di-anna' }),
      ordine({ id: 'in-viaggio', delivery_status: 'OUT_FOR_DELIVERY', wallet_applied_cents: 400 }),
      ordine({ id: 'nuovo-pagato', delivery_status: 'NEW', cash_confirmed_at: null }),
    ],
    order_items: [],
    disputes: [],
    profiles: [{ id: 'nicola', role: 'admin' }],
    notifications: [],
  });
  // L'indice `disputes_one_open_per_order` (063): un reclamo aperto per ordine.
  stato.db.unici = { disputes: [['order_id', 'status']] };
});

describe('R13-007 · il pannello annulla un ordine in contanti già pagato', () => {
  it('il sito apre da solo il reclamo con la cifra, a nome del cliente contro il negozio, e la risposta porta il link', async () => {
    const r = await premi(annullaDalPannello, 'pane-di-anna');
    expect(r.status).toBe(409);

    expect(reclami()).toHaveLength(1);
    const reclamo = reclami()[0]!;
    expect(reclamo).toMatchObject({
      order_id: 'pane-di-anna', opener_id: 'anna', against_id: 'pane-quotidiano', status: 'open',
    });
    expect(reclamo.refund_cents ?? null).toBeNull();
    expect(String(reclamo.description)).toContain('24,00');
    expect(String(reclamo.description)).toContain('annullato dall’amministrazione');

    expect(r.dettagli).toEqual({ reclamoId: reclamo.id, link: '/admin/disputes' });
    // L'ordine non si tocca: soldi e merce li decide il reclamo.
    expect(stato.db.tabelle.orders!.find((o) => o.id === 'pane-di-anna')!.delivery_status).toBe('DELIVERED');
    // Nicola riceve l'avviso.
    expect(avvisiDelReclamo().length).toBeGreaterThan(0);
  });

  it('il pannello non dice più di aprire un reclamo a chi non può, e la frase arriva intera a video', async () => {
    const r = await premi(annullaDalPannello, 'pane-di-anna');
    expect(r.messaggio).not.toMatch(/apri un reclamo/i);
    expect(r.messaggio).toMatch(/reclamo/);
    expect(friendlyError(new Error(r.messaggio))).toBe(r.messaggio);
  });

  it('vale anche per l’incasso confermato prima della consegna, e il credito usato è scritto sul reclamo', async () => {
    const r = await premi(annullaDalPannello, 'in-viaggio');
    expect(r.status).toBe(409);
    expect(reclami()).toHaveLength(1);
    expect(String(reclami()[0]!.description)).toContain('4,00');
    expect(stato.db.tabelle.orders!.find((o) => o.id === 'in-viaggio')!.delivery_status).toBe('OUT_FOR_DELIVERY');
  });

  it('premere due volte non apre due reclami: la seconda risposta porta lo stesso', async () => {
    const prima = await premi(annullaDalPannello, 'pane-di-anna');
    const seconda = await premi(annullaDalPannello, 'pane-di-anna');
    expect(reclami()).toHaveLength(1);
    expect(seconda.status).toBe(409);
    expect(seconda.dettagli?.reclamoId).toBe(prima.dettagli?.reclamoId);
  });

  it('se il cliente l’aveva già aperto, si usa il suo: nessun doppione, nessun avviso in più', async () => {
    stato.db.tabelle.disputes = [{ id: 'quello-di-anna', order_id: 'pane-di-anna', opener_id: 'anna', status: 'open' }];
    const r = await premi(annullaDalPannello, 'pane-di-anna');
    expect(reclami()).toHaveLength(1);
    expect(r.dettagli?.reclamoId).toBe('quello-di-anna');
    expect(avvisiDelReclamo()).toHaveLength(0);
  });

  it('se il reclamo non si apre, lo dice, senza mandare l’amministratore a fare un passo impossibile', async () => {
    stato.db.guasto = (s) => (s.tabella === 'disputes' && s.operazione === 'insert' ? { message: 'timeout' } : null);
    const r = await premi(annullaDalPannello, 'pane-di-anna');
    expect(r.status).toBe(409);
    expect(r.messaggio).not.toMatch(/apri un reclamo/i);
    expect(r.messaggio).toMatch(/non si è aperto/);
    expect(stato.db.tabelle.orders!.find((o) => o.id === 'pane-di-anna')!.delivery_status).toBe('DELIVERED');
  });

  // Collaudo di R13-007: il reclamo vecchio è chiuso e l'indice lascia passare quello nuovo, che
  // avviserebbe gli amministratori e fermerebbe il bonifico al negozio senza niente da restituire.
  it('un ordine già rimborsato per intero non apre un reclamo inutile: 409 senza effetti', async () => {
    stato.db.tabelle.orders!.push(
      ordine({ id: 'pane-rimborsato', payment_status: 'REFUNDED', total_price: 20, wallet_applied_cents: 400, refunded_amount_cents: 2400 }),
    );
    stato.db.tabelle.disputes = [{ id: 'vecchio', order_id: 'pane-rimborsato', opener_id: 'anna', status: 'resolved', refund_cents: 2400 }];
    const r = await premi(annullaDalPannello, 'pane-rimborsato');
    expect(r.status).toBe(409);
    expect(reclami()).toHaveLength(1);
    expect(stato.db.tabelle.notifications ?? []).toHaveLength(0);
    expect(r.messaggio).toMatch(/già rimborsato per intero/);
    expect(r.messaggio).toMatch(/niente da restituire/);
    expect(r.dettagli).toBeUndefined();
    expect(friendlyError(new Error(r.messaggio))).toBe(r.messaggio);
  });
});

describe('R13-007 · il cliente annulla un ordine in contanti già pagato', () => {
  it('il reclamo si apre da solo e il messaggio dice che è già aperto', async () => {
    const r = await premi(annullaDalCliente, 'nuovo-pagato');
    expect(r.status).toBe(409);
    expect(reclami()).toHaveLength(1);
    expect(reclami()[0]).toMatchObject({ order_id: 'nuovo-pagato', opener_id: 'anna', against_id: 'pane-quotidiano', status: 'open' });
    expect(r.messaggio).toMatch(/già aperto un reclamo/);
    expect(r.messaggio).not.toMatch(/assistenza/);
    expect(r.dettagli?.link).toBe('/orders/nuovo-pagato/dispute');
  });
});

describe('R13-007 · chi non lo chiede non apre reclami', () => {
  it('annullaERimborsa senza la richiesta (rifiuto del negozio, cliente assente) si ferma come prima', async () => {
    const o = ordine({ id: 'pane-di-anna' }) as unknown as OrdineDaAnnullare;
    const esito = await annullaERimborsa(stato.db.client as never, { ...o, id: 'pane-di-anna' }, { reason: 'rifiutato dal negozio' });
    expect(esito).toEqual({ ok: false, motivo: 'CONTANTI_INCASSATI' });
    expect(reclami()).toHaveLength(0);
  });
});

describe('R13-007 · la pagina del reclamo', () => {
  it('non dice «l’hai aperto» a chi il reclamo l’ha trovato aperto dal sito', () => {
    const pagina = readFileSync(join(process.cwd(), 'app', 'orders', '[id]', 'dispute', 'page.tsx'), 'utf8');
    expect(pagina).not.toMatch(/L&apos;hai aperto il/);
    expect(pagina).toMatch(/Aperto il \{new Date\(reclamoAperto\.created_at\)/);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * S01 — l'annullo (lib/ordini/annulla.ts), col finto database dei rimborsi.
 *  · 57: un ritiro gia' pagato al banco (DELIVERED + PAID, senza cash_confirmed_at)
 *    non si annulla in silenzio: e' «contanti incassati».
 *  · 2055: la merce che non torna a scaffale lascia un errore e un avviso.
 *  · 2463: il turno si prende sullo stato che il chiamante ha controllato.
 */
const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto.db.client }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => ({}) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: log }));

import { annullaERimborsa, type OrdineDaAnnullare } from '@/lib/ordini/annulla';

function ordine(extra: Riga = {}): Riga {
  return {
    id: 'o1', user_id: 'cliente', seller_id: 'negozio', total_price: 12, gross_total_cents: 1200,
    wallet_applied_cents: 0, payment_method: 'cod', payment_status: 'PENDING', delivery_status: 'NEW',
    stripe_payment_intent: null, cash_confirmed_at: null, refunded_amount_cents: 0, coupon_code: null,
    stripe_session_id: null, internal_dispute_status: null, ...extra,
  };
}
function apri(o: Riga) {
  finto.db = creaFintoDatabase({ orders: [o], profiles: [{ id: 'nicola', role: 'admin' }], notifications: [] });
}
beforeEach(() => {
  log.error.mockClear();
});

describe('57 — il ritiro già pagato al banco non si annulla in silenzio', () => {
  it('DELIVERED + PAID senza cash_confirmed_at → CONTANTI_INCASSATI, ordine non toccato', async () => {
    apri(ordine({ delivery_status: 'DELIVERED', payment_status: 'PAID' }));
    const esito = await annullaERimborsa(finto.db.client as never, finto.db.tabelle.orders[0] as unknown as OrdineDaAnnullare, { reason: 'x' });
    expect(esito).toMatchObject({ ok: false, motivo: 'CONTANTI_INCASSATI' });
    expect(finto.db.tabelle.orders[0].delivery_status).toBe('DELIVERED');
  });
  it('un ordine in contanti ancora da pagare si annulla come prima', async () => {
    apri(ordine());
    const esito = await annullaERimborsa(finto.db.client as never, finto.db.tabelle.orders[0] as unknown as OrdineDaAnnullare, { reason: 'x' });
    expect(esito.ok).toBe(true);
    expect(finto.db.tabelle.orders[0].delivery_status).toBe('CANCELED');
  });
});

describe('2055 — la merce che non torna a scaffale non passa in silenzio', () => {
  it('restore_stock_for_order in errore: logger.error e avviso agli amministratori', async () => {
    apri(ordine());
    const rpc = finto.db.client.rpc;
    finto.db.client.rpc = async (nome: string, args?: Record<string, unknown>) =>
      nome === 'restore_stock_for_order' ? { data: null, error: { message: 'statement timeout' } } : rpc(nome, args);
    const esito = await annullaERimborsa(finto.db.client as never, finto.db.tabelle.orders[0] as unknown as OrdineDaAnnullare, { reason: 'x' });
    expect(esito.ok).toBe(true);
    expect(log.error.mock.calls.some((c) => String(c[0]).includes('scaffale'))).toBe(true);
    expect(notificheConTitolo(finto.db, 'Merce non rimessa a scaffale')).toHaveLength(1);
  });
});

describe('2463 — l\'annullo non scrive sopra uno stato cambiato dopo il controllo', () => {
  it('controllato NEW, nel frattempo OUT_FOR_DELIVERY: zero righe, niente annullo', async () => {
    apri(ordine());
    const controllato = { ...finto.db.tabelle.orders[0] } as unknown as OrdineDaAnnullare;
    finto.db.tabelle.orders[0].delivery_status = 'OUT_FOR_DELIVERY';
    const esito = await annullaERimborsa(finto.db.client as never, controllato, { reason: 'x' });
    expect(esito.ok).toBe(false);
    expect(finto.db.tabelle.orders[0].delivery_status).toBe('OUT_FOR_DELIVERY');
  });
});

describe('202 / 1570 — la cintura del codice sconto esiste nel database', () => {
  it('la migrazione 200 crea coupon_released_at e release_coupon(p_code, p_order_id) che scala una volta sola', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('migrations/200_il_codice_sconto_torna_una_volta_per_ordine.sql', 'utf8');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS coupon_released_at timestamptz/);
    expect(sql).toMatch(/FUNCTION public\.release_coupon\(p_code text, p_order_id uuid\)/);
    // la marcatura viene prima dello scalo, e lo scalo solo se la riga e' stata marcata ora
    const marca = sql.indexOf('AND coupon_released_at IS NULL');
    const esce = sql.indexOf('IF marcato IS NULL THEN');
    const scala = sql.indexOf('SET uses_count = greatest(0, uses_count - 1)');
    expect(marca).toBeGreaterThan(0);
    expect(esce).toBeGreaterThan(marca);
    expect(scala).toBeGreaterThan(esce);
  });
});

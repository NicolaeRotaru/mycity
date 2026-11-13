// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { disegna } from './aiuti/cabina-admin';

/**
 * R17-002 — Il bonifico del lunedì al negozio si segna, e non si paga due volte.
 *
 * Al lancio Nicola versa a mano i contanti al negozio, il lunedì. Due cose, provate qui:
 *
 *  ① IL PANNELLO (app/admin/payouts/page.tsx). Collaudo K04: Nicola legge 36 €, versa 36 €, e
 *    intanto su un ordine si apre un reso; l'aggiornamento porta il tasto a 18 € e il clic segnava
 *    un ordine solo, in silenzio: il lunedì dopo l'altro chiedeva di nuovo 18 €. Adesso Nicola scrive
 *    quanto ha versato, il pannello lo manda alla funzione del database (migrazione 410, tutto o
 *    niente) e ogni rifiuto si legge sulla pagina.
 *  ② IL RIMBORSO DOPO IL BONIFICO A MANO (lib/stripe/payout.ts, refundOrder). Un ordine segnato
 *    PAID_MANUALLY è un bonifico già uscito, come TRANSFERRED: parte l'avviso «togli la quota dal
 *    prossimo bonifico» (prima solo su HELD: proprio qui la quota si perdeva in silenzio), e il
 *    rimborso pieno chiude la partita col negozio come «stornato», non «rimborsato prima di pagarlo».
 *
 * Orologio finto: lunedì 16/11/2026, consegne di giovedì 12.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase }));
const pannello = vi.hoisted(() => ({
  ordini: [] as unknown[],
  resi: [] as unknown[],
  chiamate: [] as Array<Record<string, unknown>>,
  risposta: null as unknown,
}));
const posta = vi.hoisted(() => ({ a: [] as Array<{ to: string; subject: string }> }));

function catena(dati: () => unknown, count?: number): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve({ data: dati(), error: null, count }).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) =>
      t === 'orders' ? catena(() => pannello.ordini, pannello.ordini.length) : t === 'returns' ? catena(() => pannello.resi) : catena(() => []),
    rpc: vi.fn(async (_n: string, args: Record<string, unknown>) => {
      pannello.chiamate.push(args);
      return { data: pannello.risposta, error: null };
    }),
  },
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
    transfers: { create: vi.fn(async () => ({ id: 'tr_1' })), createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async (m: { to: string; subject: string }) => { posta.a.push(m); return { ok: true }; }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

import { refundOrder, releaseOrderPayout, VAR_CONTANTI_DA_STRIPE } from '@/lib/stripe/payout';

let chiudi: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T08:00:00Z'));
  pannello.chiamate = [];
  pannello.resi = [];
  pannello.risposta = null;
  posta.a = [];
  delete process.env[VAR_CONTANTI_DA_STRIPE];
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────── ① il pannello

const A1 = 'a1a1a1a1-0000-4000-8000-000000000001';
const A2 = 'a2a2a2a2-0000-4000-8000-000000000002';
const riga = (id: string) => ({
  id, seller_id: 'forno', total_price: 20, seller_payout_cents: 1800, seller_payout_reversed_cents: 0,
  dispute_status: null, internal_dispute_status: null, payment_status: 'PAID',
  payout_status: 'HELD', payout_at: null, stripe_transfer_id: null, delivery_status: 'DELIVERED',
  payment_method: 'cod', created_at: '2026-11-10T09:00:00Z', delivered_at: '2026-11-12T15:00:00Z',
  seller: { store_name: 'Pane Quotidiano', billing_iban: 'IT60X0542811101000000123456' },
});

async function apriEPremi(risposte: string[]) {
  const mod = (await import('@/app/admin/payouts/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  vi.stubGlobal('prompt', () => risposte.shift() ?? null);
  const tasto = Array.from(r.host.querySelectorAll('button')).find((b) => b.textContent?.includes('Bonifico fatto'));
  expect(tasto, 'il tasto «Bonifico fatto» non c è').toBeTruthy();
  await act(async () => { tasto!.click(); await new Promise((ok) => setTimeout(ok, 30)); });
  return r.host;
}

const avvisi = (host: HTMLElement) => Array.from(host.querySelectorAll('[role="alert"]')).map((p) => p.textContent ?? '').join(' ');

describe('R17-002 ① — il pannello manda la cifra versata e dice ogni rifiuto', () => {
  it('collaudo K04: versati 36 €, ma un reso aperto porta i segnabili a 18 €: non segna niente e lo dice', async () => {
    pannello.ordini = [riga(A1), riga(A2)];
    pannello.resi = [{ order_id: A2 }];
    pannello.risposta = { ok: true, segnati: 1 };
    const host = await apriEPremi(['36,00', 'TRN-1']);
    // Nessuna richiesta che segni per meno di quanto versato.
    for (const c of pannello.chiamate) expect(c.p_importo_cents, 'segna senza sapere quanto è stato versato').toBe(3600);
    expect(host.textContent, 'segna un ordine solo, in silenzio').not.toMatch(/Segnati \d+ ordini come pagati/);
    expect(avvisi(host)).toMatch(/Non ho segnato niente/);
    expect(avvisi(host)).toMatch(/36,00/);
    expect(avvisi(host)).toMatch(/18,00/);
  });

  it('con la cifra giusta manda ordini, cifra in centesimi e riferimento, e dice quanti ne ha segnati', async () => {
    pannello.ordini = [riga(A1), riga(A2)];
    pannello.risposta = { ok: true, segnati: 2 };
    const host = await apriEPremi(['36,00', 'TRN-9']);
    expect(pannello.chiamate).toHaveLength(1);
    expect(pannello.chiamate[0]).toEqual({ p_seller: 'forno', p_order_ids: [A1, A2], p_importo_cents: 3600, p_riferimento: 'TRN-9' });
    expect(host.textContent).toMatch(/Segnati 2 ordini come pagati/);
  });

  it('il database rifiuta perché nel frattempo un ordine si è fermato: la pagina dice quale, e niente «Segnati»', async () => {
    pannello.ordini = [riga(A1), riga(A2)];
    pannello.risposta = { ok: false, reason: 'ORDINI_CAMBIATI', non_segnabili: [A2], dichiarato_cents: 3600 };
    const host = await apriEPremi(['36,00', 'TRN-9']);
    expect(pannello.chiamate[0]?.p_importo_cents).toBe(3600);
    expect(host.textContent).not.toMatch(/Segnati \d+ ordini/);
    expect(avvisi(host)).toMatch(/Non ho segnato niente/);
    expect(avvisi(host)).toContain('#A2A2A2');
  });

  it('il database rifiuta perché la cifra non torna più (uno storno): la pagina dice la cifra giusta', async () => {
    pannello.ordini = [riga(A1), riga(A2)];
    pannello.risposta = { ok: false, reason: 'IMPORTO_DIVERSO', atteso_cents: 3100, dichiarato_cents: 3600 };
    const host = await apriEPremi(['36', 'TRN-9']);
    expect(pannello.chiamate[0]?.p_importo_cents).toBe(3600);
    expect(host.textContent).not.toMatch(/Segnati \d+ ordini/);
    expect(avvisi(host)).toMatch(/Non ho segnato niente/);
    expect(avvisi(host)).toMatch(/31,00/);
  });
});

// ─────────────────────────────────────────── ② il rimborso dopo il bonifico a mano

const ORDINE = 'b2c3d4e5-1717-4717-8717-171717171717';

function contanti(extra: Riga = {}): Riga {
  return {
    id: ORDINE, user_id: 'anna', seller_id: 'pane',
    total_price: 23, gross_total_cents: 2300, wallet_applied_cents: 0,
    seller_payout_cents: 1800, seller_payout_reversed_cents: 0, payout_status: 'PAID_MANUALLY',
    payout_at: '2026-11-16T07:30:00Z', payout_manual_ref: 'TRN-410',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 3,
    delivery_status: 'DELIVERED', delivered_at: '2026-11-12T15:00:00Z', created_at: '2026-11-12T09:00:00Z',
    payment_status: 'PAID', cash_confirmed_at: '2026-11-12T20:00:00Z',
    internal_dispute_status: null,
    ...extra,
  };
}

function preparaDatabase(ordine: Riga) {
  finto.db = creaFintoDatabase({
    orders: [ordine],
    profiles: [
      { id: 'admin-1', role: 'admin' },
      { id: 'pane', role: 'seller', store_name: 'Pane Quotidiano' },
      { id: 'anna', role: 'buyer' },
    ],
    notifications: [],
  });
  finto.db.email.anna = 'anna@example.it';
}

const daTrattenere = () => (finto.db.tabelle.notifications ?? []).filter((n) => String(n.title ?? '').includes('Togli'));
const ordine = () => (finto.db.tabelle.orders ?? []).find((o) => o.id === ORDINE) as Riga;
const reclamo = (cents = 2300) =>
  refundOrder({ orderId: ORDINE, amountCents: cents, reason: 'reclamo', idempotencyKey: `dispute_r17_${cents}`, notifyBuyer: true });

describe('R17-002 ② — un rimborso dopo il bonifico a mano lo tratta come un bonifico già uscito', () => {
  it('rimborso pieno su un ordine PAID_MANUALLY: «togli 18,00 € dal prossimo bonifico a Pane Quotidiano»', async () => {
    preparaDatabase(contanti());
    await reclamo();
    const a = daTrattenere();
    expect(a, 'la quota del negozio già pagato a mano si perde in silenzio').toHaveLength(1);
    expect(String(a[0].title)).toContain('18,00');
    expect(String(a[0].title)).toContain('Pane Quotidiano');
    expect(String(a[0].body)).toContain('già segnato come fatto a mano');
    expect(String(a[0].body)).toContain(ORDINE.slice(0, 8));
  });

  it('rimborso pieno: la partita col negozio si chiude «stornata» (REVERSED) come dopo un bonifico Stripe, con la quota da riprendere', async () => {
    preparaDatabase(contanti());
    await reclamo();
    expect(ordine().payout_status, 'un bonifico già fatto segnato come «rimborsato prima di pagarlo»').toBe('REVERSED');
    expect(ordine().seller_payout_reversed_cents).toBe(1800);
  });

  it('anche quando i contanti di quella data li pagherebbe Stripe: l ordine è già pagato a mano, l avviso parte', async () => {
    process.env[VAR_CONTANTI_DA_STRIPE] = '2026-01-01';
    preparaDatabase(contanti());
    await reclamo();
    expect(daTrattenere(), 'la regola dei contanti pagati da Stripe zittisce l avviso del bonifico a mano').toHaveLength(1);
  });

  it('rimborso parziale: resta PAID_MANUALLY, la quota proporzionale è da riprendere e l avviso la dice', async () => {
    preparaDatabase(contanti());
    await reclamo(1150);
    expect(ordine().payout_status).toBe('PAID_MANUALLY');
    expect(ordine().seller_payout_reversed_cents).toBe(900);
    const a = daTrattenere();
    expect(a).toHaveLength(1);
    expect(String(a[0].title)).toContain('9,00');
  });

  it('il caso HELD non cambia: rimborso pieno prima del bonifico → REFUNDED, avviso «se è già partito»', async () => {
    preparaDatabase(contanti({ payout_status: 'HELD', payout_at: null, payout_manual_ref: null }));
    await reclamo();
    expect(ordine().payout_status).toBe('REFUNDED');
    const a = daTrattenere();
    expect(a).toHaveLength(1);
    expect(String(a[0].body)).toContain('Se il bonifico di quell');
  });

  it('il giro dei bonifici Stripe non paga un ordine già pagato a mano', async () => {
    process.env[VAR_CONTANTI_DA_STRIPE] = '2026-01-01';
    preparaDatabase(contanti());
    const r = await releaseOrderPayout(ORDINE);
    expect(r.ok).toBe(false);
    expect(ordine().payout_status).toBe('PAID_MANUALLY');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 15/11/2026 (R27-017) — DUE RIFIUTI NELLO STESSO ISTANTE IN UN CARRELLO DI TRE NEGOZI.
 *
 * Pane 15 €, frutta 12 € e carne 11 €, pagati con la carta: il pane porta la base (18 €), frutta e
 * carne il loro euro di fermata (13 € e 12 €), 43 € addebitati. Pane e frutta rifiutano a pochi
 * millisecondi: tutti e due mettono il segno (fattorino a 0) prima di leggere il carrello, e
 * ognuno vede il segno dell'altro.
 *
 * Prima ognuno trovava un conto fuori regola e rendeva pieno (18 + 13): la carne restava con 1 € di
 * consegna e 1 € al fattorino per un giro intero, invece di 3 € e 3 € della carne da sola. Adesso
 * il segno dell'altro vuol dire «se ne va»: il pane rifà il giro senza la frutta, la carne passa a
 * 3 € e 3 €, e i soldi tornano come se i due rifiuti fossero arrivati uno dopo l'altro (16 + 13 €).
 */

let fermaLaFrutta: Promise<void> | null = null;
let fruttaAlRimborso: (() => void) | null = null;
const refundOrder = vi.fn(async (a: { orderId: string; amountCents: number }) => {
  if (a.orderId === 'frutta' && fermaLaFrutta) {
    fruttaAlRimborso?.();
    await fermaLaFrutta;
  }
  Object.assign(riga(a.orderId), { delivery_status: 'CANCELED' });
  return { refundId: `re_${a.orderId}` };
});
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: { orderId: string; amountCents: number }) => refundOrder(a) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { annullaERimborsa } from '@/lib/ordini/annulla';
import { carrello, finto } from './carrello-finto';

const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;
const tre = () => carrello(['pane', 'frutta', 'carne'], [1500, 1200, 1100], 'card');
const resi = () => refundOrder.mock.calls.map((c) => [c[0].orderId, c[0].amountCents] as [string, number]).sort();

beforeEach(() => {
  refundOrder.mockClear();
  fermaLaFrutta = null;
  fruttaAlRimborso = null;
});

describe('R27-017 — due rifiuti nello stesso istante in un carrello di tre negozi', () => {
  it('il carrello: 18 + 13 + 12 = 43 €, fattorino 3 € sul pane e 1 € sugli altri', () => {
    const ordini = tre();
    expect(ordini.map((o) => [o.total_price, o.delivery_fee_cents, o.rider_fee_cents])).toEqual([[18, 300, 300], [13, 100, 100], [12, 100, 100]]);
  });

  it('pane e frutta col segno messo tutti e due: la carne passa a 3 € di consegna e 3 € al fattorino, tornano 16 + 13 €', async () => {
    db = finto({ orders: tre() });
    let sblocca!: () => void;
    fermaLaFrutta = new Promise<void>((r) => (sblocca = r));
    const fruttaArrivata = new Promise<void>((r) => (fruttaAlRimborso = r));
    let laFrutta: Promise<unknown> | null = null;
    // Il pane ha appena scritto il suo segno (terza istruzione sugli ordini): in quell'istante la
    // frutta rifiuta, mette il suo segno, legge il carrello col segno del pane e arriva al rimborso.
    // Solo dopo il pane legge il carrello, col segno della frutta.
    const vero = db.from;
    let istruzioni = 0;
    db.from = (t: string) => {
      const q = vero(t) as Record<string, unknown> & { then: (ok: (x: unknown) => unknown, ko: (e: unknown) => unknown) => unknown };
      if (t === 'orders' && ++istruzioni === 3 && !laFrutta) {
        const avanti = q.then;
        q.then = (ok, ko) =>
          avanti((x) => {
            laFrutta = annullaERimborsa(db as never, { ...riga('frutta') } as never, { reason: 'Rifiutato dal negozio' });
            return fruttaArrivata.then(() => ok(x));
          }, ko);
      }
      return q;
    };
    const pane = await annullaERimborsa(db as never, { ...riga('pane') } as never, { reason: 'Rifiutato dal negozio' });
    sblocca();
    const frutta = (await laFrutta) as { ok: boolean };
    expect([pane.ok, frutta.ok]).toEqual([true, true]);
    expect(resi()).toEqual([['frutta', 1300], ['pane', 1600]]);
    expect(riga('carne')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 14, gross_total_cents: 1400 });
    // 43 € addebitati, 29 € resi: il cliente paga 14 €, la carne da sola (11 + 3).
    expect(4300 - 1600 - 1300).toBe(1400);
  });

  it('gli stessi due rifiuti uno dopo l altro danno gli stessi soldi', async () => {
    db = finto({ orders: tre() });
    await annullaERimborsa(db as never, { ...riga('pane') } as never, { reason: 'Rifiutato dal negozio' });
    await annullaERimborsa(db as never, { ...riga('frutta') } as never, { reason: 'Rifiutato dal negozio' });
    expect(resi()).toEqual([['frutta', 1300], ['pane', 1600]]);
    expect(riga('carne')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 14 });
  });
});

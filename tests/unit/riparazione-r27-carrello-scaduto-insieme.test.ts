import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 15/11/2026 (R27-009) — SE IL CARRELLO SCADE TUTTO NELLO STESSO GIRO, NIENTE «IL CONTO È CAMBIATO»
 * CON CIFRE GIÀ SUPERATE.
 *
 * Pane 15 €, frutta 12 € e carne 11 € coi contanti: alla conferma 18 + 13 + 12 €. Nessun negozio
 * conferma e il giro degli scaduti li annulla tutti e tre, uno dopo l'altro. Prima ogni annullo
 * scriveva subito email e campanella col conto del momento: tre email e due campanelle «il conto
 * del tuo carrello è cambiato», e la prima diceva «alla porta paghi 15,00 €» per la frutta, annullata
 * un istante dopo. Adesso gli avvisi si scrivono a fine giro: carrello scaduto tutto, nessun conto
 * nuovo da dire; scaduti in due, il conto nuovo lo dice un avviso solo, con le cifre di fine giro.
 */

// 16/11/2026 (R27-009 correzione) — Il finto rifiuta l'importo 0 (o non valido) come il vero
// (lib/stripe/payout.ts, «importo rimborso non valido»): stessa eccezione, la classe vera.
const refundOrder = vi.fn(async (a: { orderId: string; amountCents: number }) => {
  if (!Number.isFinite(a.amountCents) || a.amountCents <= 0) throw new RimborsoNonRitentabile('refundOrder: importo rimborso non valido');
  return { refundId: `re_${a.orderId}` };
});
vi.mock('@/lib/stripe/payout', async (orig) => ({
  ...(await orig<object>()),
  refundOrder: (a: { orderId: string; amountCents: number }) => refundOrder(a),
}));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
const spedite: Array<{ text: string }> = [];
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: { text: string }) => {
    spedite.push(m);
    return { ok: true };
  }),
}));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: unknown) => h }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { finto, carrello, tentativoDiCassa } from './carrello-finto';
import { RimborsoNonRitentabile } from '@/lib/stripe/payout';

const scaduto = (s: number) => `2026-10-20T08:00:0${s}Z`;
const nb = (t: string) => t.replace(/ /g, ' ');
async function giro(): Promise<Record<string, number>> {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  return ((await (POST as unknown as () => Promise<Response>)()).json());
}
const email = () => spedite.map((m) => nb(m.text));
const campanelleDelCarrello = () =>
  (db.tabelle.notifications ?? []).filter((n) => n.title === 'Il conto del tuo carrello è cambiato').map((n) => nb(String(n.body)));

beforeEach(() => {
  spedite.length = 0;
  refundOrder.mockClear();
});

describe('R27-009 — il carrello che scade nello stesso giro', () => {
  it('scade tutto: tre email senza «alla porta paghi», nessuna campanella «il conto è cambiato»', async () => {
    const ordini = carrello(['pane', 'frutta', 'carne'], [1500, 1200, 1100], 'cod', { creati: [scaduto(0), scaduto(1), scaduto(2)] });
    expect(ordini.map((o) => o.total_price)).toEqual([18, 13, 12]);
    db = finto({ orders: ordini, cod_checkout_attempts: tentativoDiCassa(['pane', 'frutta', 'carne']) });
    const j = await giro();
    expect(j).toMatchObject({ canceled: 3 });
    expect(email()).toHaveLength(3);
    for (const testo of email()) expect(testo).not.toMatch(/alla porta paghi|ora è .* invece di/);
    expect(campanelleDelCarrello()).toEqual([]);
  });

  it('scadono pane e frutta, la carne resta: un avviso solo, con la carne a 14,00 € e la frutta ai 13,00 € della conferma', async () => {
    const ordini = carrello(['pane', 'frutta', 'carne'], [1500, 1200, 1100], 'cod', {
      creati: [scaduto(0), scaduto(1), new Date().toISOString()],
    });
    db = finto({ orders: ordini, cod_checkout_attempts: tentativoDiCassa(['pane', 'frutta', 'carne']) });
    const j = await giro();
    expect(j).toMatchObject({ canceled: 2 });
    expect(db.tabelle.orders.find((r) => r.id === 'carne')).toMatchObject({ delivery_fee_cents: 300, total_price: 14 });
    const conConto = email().filter((t) => /alla porta paghi/.test(t));
    expect(conConto).toHaveLength(1);
    expect(conConto[0]).toMatch(/#FRUTTA è annullato: non paghi i suoi 13,00 € della conferma/);
    expect(conConto[0]).toMatch(/#CARNE ora è 3,00 € invece di 1,00 €.*alla porta paghi 14,00 € invece di 12,00 €/);
    expect(conConto[0]).not.toMatch(/15,00 €/);
    expect(campanelleDelCarrello()).toHaveLength(1);
    expect(campanelleDelCarrello()[0]).toMatch(/alla porta paghi 14,00 €/);
  });
});

/**
 * 16/11/2026 (R27-009 correzione) — CON LA CARTA IL PRIMO ANNULLATO SA PERCHÉ GLI TORNA MENO.
 *
 * Pane 15 €, frutta 12 € e carne 11 € con la carta: 18 + 13 + 12 € addebitati. Annullato il pane, la
 * consegna passa alla frutta e del pane tornano 16 €. Prima di R27-009 l'email del pane lo spiegava
 * col conto della frutta (15 €, superato un istante dopo); con R27-009 non partiva più niente oltre
 * «Rimborso emesso 16 €». Adesso il pane riceve la sua riga sola, e il conto nuovo resta in un avviso.
 */
describe('R27-009 correzione — il carrello con la carta che scade nello stesso giro', () => {
  const tutte = () => email().join('\n');

  it('scade tutto: il pane riceve il perché dei 16 € su 18, nessuna cifra superata, nessuna campanella del conto', async () => {
    const ordini = carrello(['pane', 'frutta', 'carne'], [1500, 1200, 1100], 'card', { creati: [scaduto(0), scaduto(1), scaduto(2)] });
    db = finto({ orders: ordini });
    const j = await giro();
    expect(j).toMatchObject({ canceled: 3, refunded: 3 });
    expect(refundOrder.mock.calls.map((c) => [c[0].orderId, c[0].amountCents])).toEqual([['pane', 1600], ['frutta', 1300], ['carne', 1400]]);
    expect(email()).toHaveLength(1);
    expect(email()[0]).toMatch(/#PANE è annullato: ti tornano 16,00 € sulla carta, cioè 15,00 € di spesa e 1,00 € di consegna/);
    expect(tutte()).not.toMatch(/#FRUTTA|#CARNE|resta pagato/);
    expect(campanelleDelCarrello()).toEqual([]);
  });

  it('scadono pane e frutta, la carne resta: il pane ha il suo perché, il conto della carne lo dice un avviso solo', async () => {
    const ordini = carrello(['pane', 'frutta', 'carne'], [1500, 1200, 1100], 'card', {
      creati: [scaduto(0), scaduto(1), new Date().toISOString()],
    });
    db = finto({ orders: ordini });
    const j = await giro();
    expect(j).toMatchObject({ canceled: 2, refunded: 2 });
    const delPane = email().filter((t) => /#PANE è annullato/.test(t));
    expect(delPane).toHaveLength(1);
    expect(delPane[0]).toMatch(/ti tornano 16,00 € sulla carta, cioè 15,00 € di spesa e 1,00 € di consegna/);
    expect(delPane[0]).not.toMatch(/#FRUTTA|#CARNE/);
    const conConto = email().filter((t) => /#CARNE/.test(t));
    expect(conConto).toHaveLength(1);
    expect(conConto[0]).toMatch(/#CARNE ora è 3,00 € invece di 1,00 €.*resta pagato, 14,00 €/);
    expect(tutte()).not.toMatch(/resta pagato, 15,00 €/);
    expect(campanelleDelCarrello()).toHaveLength(1);
  });
});

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

vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 're_1' })) }));
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

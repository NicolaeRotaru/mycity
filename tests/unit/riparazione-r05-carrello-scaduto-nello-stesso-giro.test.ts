import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R05-020 — SE IL CARRELLO SCADE NELLO STESSO GIRO, NIENTE «IL CONTO È CAMBIATO» CON CIFRE SUPERATE.
 *
 * Pane 15 €, frutta 12 € e latte 10 €, alla porta. Il latteria ha accettato; forno e fruttivendolo
 * no, e scadono tutti e due nello stesso giro del lavoro degli ordini scaduti. Prima il cliente
 * riceveva due avvisi «il conto del tuo carrello è cambiato»: il primo (dopo il pane) diceva quanto
 * costavano frutta e latte, ma la frutta un attimo dopo era annullata anche lei. Ora l'avviso del
 * carrello arriva una volta, con le cifre finali; se il carrello scade tutto, nessuno.
 */

const spedite: Array<{ text: string; to?: string }> = [];
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: { text: string; to?: string }) => (spedite.push(m), { ok: true })),
}));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 're_1' })) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: unknown) => h }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { finto, carrello, tentativoDiCassa } from './carrello-finto';

const NATO = '2026-10-20T08:00:00Z';
async function giro() {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  return (POST as unknown as () => Promise<Response>)();
}
const contoCambiato = () => db.tabelle.notifications.filter((n) => n.user_id === 'u1' && /conto del tuo carrello/.test(String(n.title)));
const alCliente = () => spedite.filter((e) => e.to === 'u1@esempio.it').map((e) => e.text.replace(/[\u00a0\u202f]/g, ' '));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
  spedite.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('R05-020 · il carrello che scade nello stesso giro', () => {
  it('due ordini dello stesso carrello scadono insieme: un solo avviso del conto, con le cifre finali', async () => {
    const ordini = carrello(['pane', 'frutta', 'latte'], [1500, 1200, 1000], 'cod', { creati: [NATO, NATO.replace('00Z', '01Z'), NATO.replace('00Z', '02Z')] });
    ordini[2].delivery_status = 'ACCEPTED';
    db = finto({ orders: ordini, notifications: [], cod_checkout_attempts: tentativoDiCassa(['pane', 'frutta', 'latte']) });
    await giro();
    expect(db.tabelle.orders.filter((o) => o.delivery_status === 'CANCELED').map((o) => o.id)).toEqual(['pane', 'frutta']);
    const latte = db.tabelle.orders.find((o) => o.id === 'latte')!;
    const finale = `${Number(latte.total_price).toFixed(2).replace('.', ',')} €`;
    // Prima erano due: quello dopo il pane parlava ancora della frutta, annullata un attimo dopo.
    expect(contoCambiato()).toHaveLength(1);
    expect(String(contoCambiato()[0].body).replace(/[\u00a0\u202f]/g, ' ')).toContain(finale);
    // Nessuna email al cliente mette la frutta fra gli ordini che restano.
    expect(alCliente().filter((t) => /#FRUTTA/i.test(t) && /#PANE/i.test(t))).toHaveLength(0);
  });

  it('il carrello scade tutto nello stesso giro: nessun avviso del conto', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'cod', { creati: [NATO, NATO.replace('00Z', '01Z')] });
    db = finto({ orders: ordini, notifications: [], cod_checkout_attempts: tentativoDiCassa(['pane', 'frutta']) });
    await giro();
    expect(db.tabelle.orders.every((o) => o.delivery_status === 'CANCELED')).toBe(true);
    expect(contoCambiato()).toHaveLength(0);
    expect(alCliente()).toHaveLength(2);
  });
});

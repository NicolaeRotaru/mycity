import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R15-013 — Il cliente con la carta riceveva un'email in più, quasi vuota, quando il suo carrello
 * scadeva tutto nello stesso giro degli ordini scaduti.
 *
 * Con la carta ogni ordine annullato manda «Rimborso emesso». Se il carrello si rifaceva, partiva anche
 * l'email di annullo col conto degli ordini rimasti; ma se nel giro scadevano tutti, di rimasti non ce
 * n'erano più e l'email ripeteva il rimborso senza nessuna riga del carrello. Qui si conta quali email
 * arrivano al cliente; i rimborsi restano quelli di prima.
 */

vi.mock('@/lib/stripe/payout', () => ({
  refundOrder: vi.fn(async (a: { amountCents: number }) => ({ refundId: 're_1', importoCents: a.amountCents })),
}));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: unknown) => h }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { finto, carrello, tentativoDiCassa } from './carrello-finto';
import { sendEmail } from '@/lib/email/client';
import { refundOrder } from '@/lib/stripe/payout';

const ADESSO = '2026-10-21T10:00:00.000Z';
const SCADUTO = '2026-10-20T08:00:00.000Z';
const SCADUTO_DOPO = '2026-10-20T08:00:01.000Z';

const nb = (s: string) => s.replace(/ /g, ' ');
const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;
/** Le email al cliente: oggetto e testo. */
const alCliente = () =>
  vi.mocked(sendEmail).mock.calls
    .map((c) => c[0] as { to: string; subject: string; text: string })
    .filter((m) => m.to === 'u1@esempio.it')
    .map((m) => ({ subject: nb(String(m.subject)), text: nb(String(m.text)) }));
const rimborsi = () => alCliente().filter((m) => /Rimborso emesso/.test(m.subject));
const annulli = () => alCliente().filter((m) => /annullato/.test(m.subject));

async function giro() {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  return (POST as unknown as () => Promise<Response>)();
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(ADESSO), toFake: ['Date'] });
  vi.mocked(sendEmail).mockClear();
  vi.mocked(refundOrder).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('R15-013 · carrello pagato con la carta scaduto tutto nello stesso giro', () => {
  it('pane e frutta scadono insieme: per ogni ordine solo «Rimborso emesso», niente email di annullo vuota', async () => {
    db = finto({ orders: carrello(['pane', 'frutta'], [1500, 1200], 'card', { creati: [SCADUTO, SCADUTO_DOPO] }) });
    await giro();
    expect(riga('pane').delivery_status).toBe('CANCELED');
    expect(riga('frutta').delivery_status).toBe('CANCELED');
    // I soldi: un rimborso per ordine, come prima.
    expect(vi.mocked(refundOrder).mock.calls.map((c) => (c[0] as { orderId: string }).orderId)).toEqual(['pane', 'frutta']);
    expect(rimborsi()).toHaveLength(2);
    expect(annulli(), 'un\'email di annullo senza righe del carrello, in più del rimborso').toEqual([]);
    expect(alCliente()).toHaveLength(2);
  });

  it('se un ordine del carrello resta, l\'email di annullo parte ancora e dice il suo conto', async () => {
    db = finto({ orders: carrello(['pane', 'frutta'], [1500, 1200], 'card', { creati: [SCADUTO, ADESSO] }) });
    await giro();
    expect(riga('pane').delivery_status).toBe('CANCELED');
    expect(riga('frutta').delivery_status).toBe('NEW');
    expect(rimborsi()).toHaveLength(1);
    expect(annulli()).toHaveLength(1);
    expect(annulli()[0].text).toMatch(/#FRUTTA/);
  });

  it('con i contanti, tutto scaduto: l\'email di annullo per ogni ordine resta (non c\'è un rimborso che lo dica)', async () => {
    db = finto({
      orders: carrello(['pane', 'frutta'], [1500, 1200], 'cod', { creati: [SCADUTO, SCADUTO_DOPO] }),
      cod_checkout_attempts: tentativoDiCassa(['pane', 'frutta']),
    });
    await giro();
    expect(rimborsi()).toEqual([]);
    expect(annulli().filter((m) => /#PANE/.test(m.subject))).toHaveLength(1);
    expect(annulli().filter((m) => /#FRUTTA/.test(m.subject))).toHaveLength(1);
  });
});

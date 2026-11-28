import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Onda 2 · R06-006 — Il giro che annulla leggeva al massimo cento ordini fermi: una veloce scaduta
 * poteva restare fuori dal giro.
 *
 * Il giro degli ordini scaduti leggeva i cento NEW più vecchi e decideva uno per uno se erano ancora
 * nei tempi. I più vecchi sono spesso ordini su una fascia lontana (i «Domani» presi la mattina),
 * ancora buoni: con cento di quelli in testa, la veloce scaduta nata dopo non entrava mai fra i
 * cento letti, e con la carta il cliente restava addebitato senza che nessuno accettasse. Ora la
 * lettura scorre le pagine finché trova gli scaduti.
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

import { finto, carrello, type Riga } from './carrello-finto';
import { refundOrder } from '@/lib/stripe/payout';

// Mercoledì 21/10 alle 12:00 di Piacenza.
const ADESSO = '2026-10-21T10:00:00.000Z';

/** Cento ordini presi alle 8 per «Domani · 9:00–12:00»: ancora nei tempi, e più vecchi della veloce. */
function domaniAncoraBuoni(quanti: number): Riga[] {
  const [modello] = carrello(['modello'], [1000], 'card');
  return Array.from({ length: quanti }, (_, i) => ({
    ...modello,
    id: `domani-${String(i).padStart(3, '0')}`,
    user_id: `u-domani-${i}`,
    stripe_payment_intent: `pi_domani_${i}`,
    stripe_session_id: `cs_domani_${i}`,
    delivery_slot: 'Domani · 9:00–12:00',
    created_at: `2026-10-21T06:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`,
  }));
}

/** La veloce pagata con la carta alle 8:30: tre ore e mezza dopo il negozio non l'ha accettata. */
function laVeloceScaduta(): Riga {
  const [veloce] = carrello(['veloce'], [1500], 'card', { veloce: true, creati: ['2026-10-21T06:30:00.000Z'] });
  return { ...veloce, stripe_payment_intent: 'pi_veloce', stripe_session_id: 'cs_veloce' };
}

async function giro(): Promise<Record<string, unknown>> {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  const res = await (POST as unknown as () => Promise<Response>)();
  return (await res.json()) as Record<string, unknown>;
}

const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(ADESSO), toFake: ['Date'] });
  vi.mocked(refundOrder).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('R06-006 · la veloce scaduta dietro cento ordini ancora buoni', () => {
  it('con cento «Domani» più vecchi in testa, la veloce scaduta si annulla e si rimborsa lo stesso', async () => {
    db = finto({ orders: [...domaniAncoraBuoni(100), laVeloceScaduta()] });

    const esito = await giro();

    expect(riga('veloce').delivery_status, 'la veloce scaduta restava fuori dai cento letti').toBe('CANCELED');
    expect(vi.mocked(refundOrder).mock.calls.map((c) => (c[0] as { orderId: string }).orderId)).toEqual(['veloce']);
    // I «Domani» restano nuovi: sono ancora nei tempi.
    expect(db.tabelle.orders.filter((r) => String(r.id).startsWith('domani-') && r.delivery_status !== 'NEW')).toEqual([]);
    expect(esito).toMatchObject({ ok: true, canceled: 1, rinviati: 100 });
  });

  it('con meno di cento fermi si legge una pagina sola, come prima', async () => {
    db = finto({ orders: [...domaniAncoraBuoni(3), laVeloceScaduta()] });
    const esito = await giro();
    expect(riga('veloce').delivery_status).toBe('CANCELED');
    expect(esito).toMatchObject({ canceled: 1, rinviati: 3 });
  });
});

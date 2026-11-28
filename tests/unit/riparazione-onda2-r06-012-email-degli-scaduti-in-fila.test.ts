import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Onda 2 · R06-012 — Con molti ordini scaduti nello stesso giro, le email di annullo partivano tutte
 * insieme dopo la risposta.
 *
 * Il giro degli ordini scaduti registra con `after()` di Next fino a tre email per ordine (cliente,
 * «Rimborso emesso», negozio). Next, dopo la risposta, fa partire INSIEME tutti i lavori registrati
 * (una coda senza tetto): cento ordini, trecento invii nello stesso istante, e il limite d'invio della
 * posta ne respingeva molti, ognuno con un avviso agli amministratori. Le altre email dopo la risposta
 * passavano già dalla fila di lib/api/dopo-la-risposta.ts (R05-003); quelle di lib/ordini/annulla.ts no.
 *
 * Qui `after()` è finto come Next: tiene da parte i lavori e a fine richiesta li fa partire tutti
 * insieme. Si conta quanti invii sono in volo nello stesso momento.
 */

const dopo: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => ({
  ...(await orig<object>()),
  after: (lavoro: () => unknown) => void dopo.push(lavoro),
}));

const posta = vi.hoisted(() => ({ inVolo: 0, massimo: 0, spedite: 0 }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async () => {
    posta.inVolo++;
    posta.massimo = Math.max(posta.massimo, posta.inVolo);
    await new Promise((r) => setTimeout(r, 5));
    posta.inVolo--;
    posta.spedite++;
    return { ok: true, id: 'e1' };
  }),
}));
vi.mock('@/lib/stripe/payout', () => ({
  refundOrder: vi.fn(async (a: { amountCents: number }) => ({ refundId: 're_1', importoCents: a.amountCents })),
}));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: unknown) => h }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { finto, carrello } from './carrello-finto';

const ADESSO = '2026-10-21T10:00:00.000Z';

/** Dieci ordini pagati con la carta, ognuno da un cliente e un negozio suoi, tutti scaduti. */
function scaduti(quanti: number) {
  return Array.from({ length: quanti }, (_, i) => {
    const [o] = carrello([`ordine-${i}`], [1500], 'card', { creati: [`2026-10-20T08:00:0${i}.000Z`] });
    return { ...o, user_id: `u${i}`, seller_id: `s${i}`, stripe_payment_intent: `pi_${i}`, stripe_session_id: `cs_${i}` };
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(ADESSO), toFake: ['Date'] });
  dopo.length = 0;
  posta.inVolo = 0;
  posta.massimo = 0;
  posta.spedite = 0;
});
afterEach(() => vi.useRealTimers());

describe('R06-012 · le email del giro degli scaduti partono in fila dopo la risposta', () => {
  it('dieci ordini scaduti: dopo la risposta un invio alla volta, e partono tutti', async () => {
    db = finto({ orders: scaduti(10) });
    const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
    await (POST as unknown as () => Promise<Response>)();

    expect(posta.spedite, 'durante la richiesta non parte niente').toBe(0);
    // A fine richiesta Next fa partire insieme tutti i lavori registrati.
    await Promise.all(dopo.map((lavoro) => lavoro()));

    // «Rimborso emesso» al cliente e l'annullo al negozio, per ognuno dei dieci ordini.
    expect(posta.spedite).toBe(20);
    expect(posta.massimo, 'gli invii partivano tutti nello stesso istante').toBe(1);
  });
});

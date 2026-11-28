import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Onda 2 · R06-005 — Il giro degli ordini scaduti ricopiava la logica di annullo invece di usare
 * quella di lib/ordini/annulla.ts.
 *
 * Il pezzo che costava soldi al cliente: la restituzione del credito MyCity. L'annullo
 * (`annullaERimborsa`) ci prova tre volte, in modo sicuro (`wallet_credit` è idempotente su
 * motivo+ordine); la copia del giro ci provava una volta sola. Un timeout passeggero e il credito
 * restava fermo, con un avviso agli amministratori e un lavoro a mano. Ora il giro usa la stessa
 * restituzione (`restituisciIlCreditoDellOrdine`). Qui la prima scrittura del credito cade e la
 * seconda riesce, come un timeout vero.
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

import { finto, carrello } from './carrello-finto';
import { sendEmail } from '@/lib/email/client';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';

const ADESSO = '2026-10-21T10:00:00.000Z';
const SCADUTO = '2026-10-20T08:00:00.000Z';

const nb = (s: string) => s.replace(/[  ]/g, ' ');
const chiamateCredito: Array<Record<string, unknown>> = [];

async function giro(): Promise<Record<string, unknown>> {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  const res = await (POST as unknown as () => Promise<Response>)();
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(ADESSO), toFake: ['Date'] });
  vi.mocked(sendEmail).mockClear();
  vi.mocked(notifyAdmins).mockClear();
  chiamateCredito.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('R06-005 · il giro degli scaduti rende il credito MyCity con la stessa strada dell annullo', () => {
  it('la prima scrittura del credito cade, la seconda riesce: il credito torna e nessun lavoro a mano', async () => {
    const [ordine] = carrello(['pane'], [1500], 'cod', { creati: [SCADUTO] });
    ordine.wallet_applied_cents = 500;
    db = finto({ orders: [ordine] });
    db.rpc = (async (nome: string, args?: Record<string, unknown>) => {
      if (nome !== 'wallet_credit') return { data: null, error: null };
      chiamateCredito.push(args ?? {});
      return chiamateCredito.length === 1 ? { data: null, error: { message: 'timeout' } } : { data: null, error: null };
    }) as never;

    const esito = await giro();

    expect(chiamateCredito.length, 'un tentativo solo: il timeout lasciava il credito fermo').toBe(2);
    // Lo stesso motivo e lo stesso ordine a ogni tentativo: `wallet_credit` non accredita due volte.
    expect(chiamateCredito.map((a) => [a.p_reason, a.p_ref, a.p_cents])).toEqual([
      ['order_auto_canceled', 'pane', 500],
      ['order_auto_canceled', 'pane', 500],
    ]);
    expect(esito).toMatchObject({ canceled: 1, ripristiniFalliti: 0 });
    expect(vi.mocked(notifyAdmins).mock.calls.some((c) => /non è tornato|Credito MyCity/.test(`${c[0]} ${c[1]}`))).toBe(false);
    const allaCliente = vi.mocked(sendEmail).mock.calls.map((c) => nb(String((c[0] as { text: string }).text)));
    expect(allaCliente.some((t) => /credito MyCity/.test(t) && /restituito/.test(t))).toBe(true);
  });

  it('se il credito non torna nemmeno ai tentativi, l avviso resta quello del giro, una volta', async () => {
    const [ordine] = carrello(['pane'], [1500], 'cod', { creati: [SCADUTO] });
    ordine.wallet_applied_cents = 500;
    db = finto({ orders: [ordine] });
    db.rpc = (async (nome: string) => (nome === 'wallet_credit' ? { data: null, error: { message: 'giù' } } : { data: null, error: null })) as never;

    const esito = await giro();

    expect(esito).toMatchObject({ ripristiniFalliti: 1 });
    const avvisi = vi.mocked(notifyAdmins).mock.calls.map((c) => `${c[0]} ${c[1]}`).filter((t) => /credito MyCity/.test(t));
    expect(avvisi, 'due avvisi per lo stesso credito').toHaveLength(1);
    expect(avvisi[0]).toMatch(/il credito MyCity speso \(5,00 €\) non è tornato/);
  });
});

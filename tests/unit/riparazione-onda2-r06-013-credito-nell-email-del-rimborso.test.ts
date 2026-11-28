import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Onda 2 · R06-013 — Con la carta e il credito MyCity insieme, quando il carrello scade tutto nessuna
 * email diceva che il credito era tornato.
 *
 * Il giro degli ordini scaduti rende la carta (refundOrder) e poi il credito MyCity speso
 * (wallet_credit). Al cliente con la carta parte «Rimborso emesso», che diceva solo la carta; l'email
 * di annullo, l'unica che dice «il credito ti è stato restituito», con la carta parte solo se restano
 * ordini del carrello (R15-013). Carrello scaduto tutto: il credito tornava sul saldo e nessuno lo
 * diceva. Lo stesso col cliente che annulla un ordine solo con la carta (annullaERimborsa).
 * Ora «Rimborso emesso» parte dopo lo storno e dice anche il credito tornato davvero.
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

const ADESSO = '2026-10-21T10:00:00.000Z';
const SCADUTO = '2026-10-20T08:00:00.000Z';
const SCADUTO_DOPO = '2026-10-20T08:00:01.000Z';

const nb = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');
const alCliente = () =>
  vi.mocked(sendEmail).mock.calls
    .map((c) => c[0] as { to: string; subject: string; text: string; html: string })
    .filter((m) => m.to === 'u1@esempio.it')
    .map((m) => ({ subject: nb(String(m.subject)), text: nb(String(m.text)), html: nb(String(m.html)) }));
const parlaDelCredito = () => alCliente().filter((m) => /credito MyCity/.test(m.text));

async function giro() {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  return (POST as unknown as () => Promise<Response>)();
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(ADESSO), toFake: ['Date'] });
  vi.mocked(sendEmail).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('R06-013 · carrello con la carta e il credito MyCity scaduto tutto nello stesso giro', () => {
  it('«Rimborso emesso» del pane dice anche i 4 € di credito tornati', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', { creati: [SCADUTO, SCADUTO_DOPO] });
    ordini[0].wallet_applied_cents = 400;
    db = finto({ orders: ordini });
    const chiamateRpc: Array<{ nome: string; args: Record<string, unknown> }> = [];
    db.rpc = (async (nome: string, args?: Record<string, unknown>) => (chiamateRpc.push({ nome, args: args ?? {} }), { data: null, error: null })) as never;

    await giro();

    // I soldi: il credito torna come prima.
    expect(chiamateRpc.filter((c) => c.nome === 'wallet_credit').map((c) => c.args.p_cents)).toEqual([400]);
    // L'email: una sola parla del credito, ed è «Rimborso emesso» del pane.
    const credito = parlaDelCredito();
    expect(credito, 'nessuna email diceva che il credito MyCity era tornato').toHaveLength(1);
    expect(credito[0].subject).toMatch(/Rimborso emesso/);
    expect(credito[0].text).toMatch(/4,00 € di credito MyCity/);
    expect(credito[0].html).toMatch(/Gift card/);
    // Niente email in più rispetto a R15-013: un «Rimborso emesso» per ordine.
    expect(alCliente()).toHaveLength(2);
  });

  it('se il credito non torna, «Rimborso emesso» non lo promette', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', { creati: [SCADUTO, SCADUTO_DOPO] });
    ordini[0].wallet_applied_cents = 400;
    db = finto({ orders: ordini });
    db.rpc = (async (nome: string) =>
      nome === 'wallet_credit' ? { data: null, error: { message: 'timeout' } } : { data: null, error: null }) as never;

    await giro();

    expect(alCliente().filter((m) => /Rimborso emesso/.test(m.subject))).toHaveLength(2);
    expect(parlaDelCredito()).toEqual([]);
  });
});

describe('R06-013 · il cliente annulla un ordine solo, pagato con la carta e il credito', () => {
  it('«Rimborso emesso» dice anche il credito tornato', async () => {
    const [ordine] = carrello(['pane'], [1500], 'card');
    ordine.wallet_applied_cents = 500;
    db = finto({ orders: [ordine] });
    const { annullaERimborsa } = await import('@/lib/ordini/annulla');

    const esito = await annullaERimborsa(db as never, { ...ordine } as never, {
      reason: 'Annullato dal cliente',
      metadata: { source: 'buyer_cancel' },
    });

    expect(esito.ok).toBe(true);
    const credito = parlaDelCredito();
    expect(credito).toHaveLength(1);
    expect(credito[0].subject).toMatch(/Rimborso emesso/);
    expect(credito[0].text).toMatch(/5,00 € di credito MyCity/);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 31/10/2026 — IL CREDITO MYCITY CHE NON TORNAVA DOPO UN ANNULLO NON LO VEDEVA NESSUNO.
 *
 * Annullano un ordine il cliente, il negozio che rifiuta, il giro degli ordini
 * fermi, l'amministratore e (da oggi) il fattorino col cliente assente. In
 * tutti i casi il credito MyCity speso torna con `wallet_credit`. Se quella
 * chiamata cadeva per un timeout, il codice scriveva solo `logger.warn` e
 * rispondeva ok: l'ordine era già CANCELED, un secondo annullo rispondeva
 * GIA_ANNULLATO, e i 5 € del cliente restavano fermi senza che nessuno lo sapesse.
 *
 * Qui: un errore passeggero si ritenta (con la stessa chiave, che la 143 rende
 * idempotente), e uno che non passa avvisa gli amministratori e lo dice nell'esito.
 */

const refundOrderMock = vi.fn(async (_o: unknown) => ({ refundId: 're_1', reversedCents: 0 }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (o: unknown) => refundOrderMock(o) }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
const notifyAdminsMock = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: (...a: unknown[]) => notifyAdminsMock(...a) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));

import { annullaERimborsa, type OrdineDaAnnullare } from '@/lib/ordini/annulla';

/** Quante volte di fila `wallet_credit` deve cadere prima di riuscire. */
let cadute = 0;
let rpc: Array<{ name: string; args: Record<string, unknown> }> = [];

const adminFinto = {
  from: () => ({
    update: () => {
      const catena: Record<string, unknown> = {
        eq: () => catena,
        neq: () => catena,
        select: () => Promise.resolve({ data: [{ id: 'o1' }], error: null }),
      };
      return catena;
    },
  }),
  rpc: (name: string, args: Record<string, unknown>) => {
    rpc.push({ name, args });
    if (name === 'wallet_credit' && cadute > 0) {
      cadute -= 1;
      return Promise.resolve({ data: null, error: { message: 'canceling statement due to statement timeout' } });
    }
    return Promise.resolve({ data: 1500, error: null });
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function ordine(p: Partial<OrdineDaAnnullare> = {}): OrdineDaAnnullare {
  return {
    id: 'o1aaaa-0000',
    user_id: 'u1',
    seller_id: 's1',
    total_price: 10,
    payment_method: 'cod',
    payment_status: 'PENDING',
    delivery_status: 'NEW',
    stripe_payment_intent: null,
    wallet_applied_cents: 500,
    cash_confirmed_at: null,
    refunded_amount_cents: 0,
    ...p,
  };
}
const carta = () => ordine({ payment_method: 'card', payment_status: 'PAID', stripe_payment_intent: 'pi_1' });
const accrediti = () => rpc.filter((c) => c.name === 'wallet_credit');

beforeEach(() => {
  cadute = 0;
  rpc = [];
  refundOrderMock.mockClear();
  notifyAdminsMock.mockClear();
  logger.error.mockClear();
});

describe.each([
  ['contanti', ordine],
  ['carta', carta],
])('annullo pagato con %s e 5 € di credito MyCity', (_come, fai) => {
  it('un timeout passeggero non fa perdere il credito: si ritenta con la stessa chiave', async () => {
    cadute = 1;
    const esito = await annullaERimborsa(adminFinto, fai(), { reason: 'annullato', motivoCredito: 'order_canceled_by_buyer' });

    expect(accrediti().length, 'dopo il primo timeout nessuno ha ritentato: 5 € persi').toBe(2);
    // La stessa chiave a ogni tentativo: è quello che rende il ritentativo innocuo (migrazione 143).
    for (const c of accrediti()) {
      expect(c.args).toMatchObject({ p_user: 'u1', p_cents: 500, p_reason: 'order_canceled_by_buyer', p_ref: 'o1aaaa-0000' });
    }
    expect(esito.ok).toBe(true);
    expect(esito).not.toHaveProperty('creditoNonTornatoCents');
    expect(notifyAdminsMock).not.toHaveBeenCalled();
  });

  it('se il credito non torna nemmeno ritentando, lo sanno gli amministratori e chi ha chiamato', async () => {
    cadute = 99;
    const esito = await annullaERimborsa(adminFinto, fai(), { reason: 'annullato' });

    expect(esito).toMatchObject({ ok: true, creditoNonTornatoCents: 500 });
    expect(notifyAdminsMock, 'il credito è rimasto fermo e nessuno è stato avvisato').toHaveBeenCalledTimes(1);
    const [titolo, corpo] = notifyAdminsMock.mock.calls[0] as [string, string];
    expect(titolo).toMatch(/credito/i);
    expect(corpo).toContain('5,00 €');
    expect(corpo).toContain('o1aaaa-0000');
    expect(corpo).toContain('u1');
    expect(logger.error).toHaveBeenCalled();
    // Il ritentativo ha un tetto: non si martella il database all'infinito.
    expect(accrediti().length).toBeLessThanOrEqual(3);
  });
});

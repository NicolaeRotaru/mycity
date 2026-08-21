import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ANNULLARE UN ORDINE VUOL DIRE ANCHE RESTITUIRE I SOLDI (radiografia 21/8/2026).
 *
 * Il pulsante «Annulla ordine» chiamava direttamente `cancel_order` del
 * database, che fa due cose: mette l'ordine in CANCELED e rimette la merce a
 * magazzino. Del denaro non si occupava nessuno.
 *
 * Il cliente pagava 24 €, annullava dieci minuti dopo perché aveva sbagliato
 * indirizzo, leggeva «Niente addebiti» — e sull'estratto conto i 24 € c'erano.
 * Nessun processo li restituiva: restavano finché qualcuno non se ne accorgeva
 * a mano. Stessa cosa per il credito MyCity speso sull'ordine.
 *
 * La logica giusta esisteva, ma in copia unica dentro la rotta
 * dell'amministrazione — un percorso che il cliente non attraversa mai.
 */

const refundOrderMock = vi.fn(async (_opts: { orderId: string; amountCents: number }) => ({ refundId: 're_1', reversedCents: 0 }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (o: unknown) => refundOrderMock(o as { orderId: string; amountCents: number }) }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { annullaERimborsa, type OrdineDaAnnullare } from '@/lib/ordini/annulla';

const stato: { updates: Record<string, unknown>[]; rpc: Array<{ name: string; args: Record<string, unknown> }> } = {
  updates: [], rpc: [],
};

const adminFinto = {
  from: () => ({
    update: (u: Record<string, unknown>) => ({
      eq: () => { stato.updates.push(u); return Promise.resolve({ error: null }); },
    }),
  }),
  rpc: (name: string, args: Record<string, unknown>) => {
    stato.rpc.push({ name, args });
    return Promise.resolve({ data: null, error: null });
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function ordine(p: Partial<OrdineDaAnnullare> = {}): OrdineDaAnnullare {
  return {
    id: 'o1',
    user_id: 'u1',
    seller_id: 's1',
    total_price: 24,
    payment_method: 'card',
    payment_status: 'PAID',
    delivery_status: 'NEW',
    stripe_payment_intent: 'pi_1',
    wallet_applied_cents: 0,
    cash_confirmed_at: null,
    refunded_amount_cents: 0,
    ...p,
  };
}

beforeEach(() => {
  stato.updates = [];
  stato.rpc = [];
  refundOrderMock.mockClear();
});

describe('annullamento di un ordine pagato con carta', () => {
  it('i soldi tornano al cliente, non restano a noi', async () => {
    const esito = await annullaERimborsa(adminFinto, ordine(), { reason: 'annullato dal cliente' });

    expect(esito).toEqual({ ok: true, refundId: 're_1' });
    expect(refundOrderMock, 'nessun rimborso chiesto: i 24 € restano a MyCity').toHaveBeenCalledTimes(1);
    expect(refundOrderMock.mock.calls[0][0]).toMatchObject({ orderId: 'o1', amountCents: 2400 });
  });

  it('su un ordine già rimborsato in parte torna solo il residuo', async () => {
    await annullaERimborsa(adminFinto, ordine({ payment_status: 'PARTIALLY_REFUNDED', refunded_amount_cents: 1000 }), {
      reason: 'annullato',
    });
    expect(refundOrderMock.mock.calls[0][0]).toMatchObject({ amountCents: 1400 });
  });

  it('se il rimborso fallisce lo dice, invece di annullare in silenzio', async () => {
    refundOrderMock.mockRejectedValueOnce(new Error('carta scaduta'));
    const esito = await annullaERimborsa(adminFinto, ordine(), { reason: 'annullato' });
    expect(esito).toEqual({ ok: false, motivo: 'RIMBORSO_FALLITO', dettaglio: 'carta scaduta' });
  });
});

describe('annullamento di un ordine non pagato con carta', () => {
  it('il credito MyCity speso torna al cliente', async () => {
    const esito = await annullaERimborsa(
      adminFinto,
      ordine({ payment_method: 'cod', payment_status: 'PENDING', stripe_payment_intent: null, wallet_applied_cents: 500 }),
      { reason: 'annullato' },
    );

    expect(esito).toEqual({ ok: true, refundId: null });
    const credito = stato.rpc.find((c) => c.name === 'wallet_credit');
    expect(credito, 'il credito speso non è stato restituito').toBeDefined();
    expect(credito?.args).toMatchObject({ p_user: 'u1', p_cents: 500 });
    expect(stato.rpc.some((c) => c.name === 'restore_stock_for_order')).toBe(true);
    expect(refundOrderMock).not.toHaveBeenCalled();
  });

  it('contanti già incassati dal fattorino: non si annulla in silenzio', async () => {
    const esito = await annullaERimborsa(
      adminFinto,
      ordine({ payment_method: 'cod', stripe_payment_intent: null, cash_confirmed_at: '2026-08-21T10:00:00Z' }),
      { reason: 'annullato' },
    );
    expect(esito).toEqual({ ok: false, motivo: 'CONTANTI_INCASSATI' });
    expect(stato.updates.length, 'l ordine è stato annullato lasciando il cliente senza merce e senza soldi').toBe(0);
  });
});

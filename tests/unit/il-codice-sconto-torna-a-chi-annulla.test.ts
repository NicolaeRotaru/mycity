import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL CODICE SCONTO TORNA A CHI ANNULLA, E ANNULLARE DUE VOLTE NON REGALA NIENTE.
 *
 * 27/8/2026 (R121) — IL BUONO RESTAVA BRUCIATO. Il codice si consuma in modo
 * atomico prima di creare l'ordine (`claim_coupon`). La restituzione
 * (`release_coupon`) c'era, ma la chiamavano solo il rifiuto del negozio e i
 * rimbalzi del carrello. Dal 21/8 il pulsante «Annulla ordine» del cliente
 * passa da `annullaERimborsa`, e `coupon_code` non era nemmeno fra le colonne
 * lette: il dato non arrivava e nessuno restituiva niente. Il cliente perdeva
 * il buono di benvenuto senza aver comprato niente, e lo scopriva premendo
 * «Applica» — cioè mentre stava riprovando a ordinare. La prova SQL che
 * copriva il caso esercitava la funzione `cancel_order` del database, cioè la
 * strada che il cliente non attraversa più: passava verde su un percorso morto.
 *
 * 27/8/2026 (R131) — ANNULLARE DUE VOLTE ACCREDITAVA DUE VOLTE. L'UPDATE che
 * mette l'ordine in CANCELED non aveva nessuna condizione sullo stato di
 * partenza: la guardia viveva solo nel `if` JavaScript dei chiamanti, e fra la
 * lettura e la scrittura non c'era niente. Due annulli sovrapposti — il giro
 * degli ordini fermi contro il pulsante del cliente, o un ritentativo di rete
 * — passavano tutti e due, e `restore_stock_for_order` (una somma senza
 * guardia) più `wallet_credit` giravano due volte: su un ordine pagato con
 * 50 € di credito sono 50 € regalati, più pezzi di magazzino che non esistono
 * e che il negozio venderà.
 */

const refundOrderMock = vi.fn(async () => ({ refundId: 're_1', reversedCents: 0 }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: () => refundOrderMock() }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { annullaERimborsa, COLONNE_ANNULLO, type OrdineDaAnnullare } from '@/lib/ordini/annulla';

const stato: {
  /** Righe restituite dalla rivendicazione dell'ordine: vuoto = l'ha già preso un altro. */
  righePrese: Array<{ id: string }>;
  rpc: Array<{ nome: string; args: Record<string, unknown> }>;
} = { righePrese: [{ id: 'o1' }], rpc: [] };

/** Il finto database registra la rivendicazione e le funzioni chiamate. */
const adminFinto = {
  from: () => ({
    update: () => {
      const catena: Record<string, unknown> = {
        eq: () => catena,
        neq: () => catena,
        select: () => Promise.resolve({ data: stato.righePrese, error: null }),
      };
      return catena;
    },
  }),
  rpc: (nome: string, args: Record<string, unknown>) => {
    stato.rpc.push({ nome, args });
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
    payment_method: 'cod',
    payment_status: 'PENDING',
    delivery_status: 'NEW',
    stripe_payment_intent: null,
    wallet_applied_cents: 5000,
    cash_confirmed_at: null,
    refunded_amount_cents: 0,
    coupon_code: 'BENVENUTO10',
    ...p,
  };
}

const chiamate = (nome: string) => stato.rpc.filter((c) => c.nome === nome);

beforeEach(() => {
  stato.righePrese = [{ id: 'o1' }];
  stato.rpc = [];
  refundOrderMock.mockClear();
});

describe('il codice sconto di un ordine annullato torna disponibile', () => {
  it('IL CASO CHE ROMPEVA — annullo di un ordine in contanti: il buono torna', async () => {
    const esito = await annullaERimborsa(adminFinto, ordine(), { reason: 'annullato dal cliente' });

    expect(esito).toEqual({ ok: true, refundId: null });
    const reso = chiamate('release_coupon');
    expect(reso, 'il cliente ha perso il buono senza aver comprato niente').toHaveLength(1);
    expect(reso[0].args).toMatchObject({ p_code: 'BENVENUTO10' });
  });

  it('anche sull ordine pagato con carta il buono torna', async () => {
    await annullaERimborsa(
      adminFinto,
      ordine({ payment_method: 'card', payment_status: 'PAID', stripe_payment_intent: 'pi_1' }),
      { reason: 'annullato dal cliente' },
    );
    expect(chiamate('release_coupon'), 'sul ramo carta il buono restava bruciato').toHaveLength(1);
  });

  it('senza codice sconto non si chiama nessuno', async () => {
    await annullaERimborsa(adminFinto, ordine({ coupon_code: null }), { reason: 'annullato' });
    expect(chiamate('release_coupon')).toHaveLength(0);
  });

  it('il codice sconto è fra le colonne lette: senza, il dato non arriva nemmeno', () => {
    // Era la causa vera: `coupon_code` mancava da COLONNE_ANNULLO, quindi le
    // rotte di annullamento non lo leggevano e non potevano restituirlo.
    expect(COLONNE_ANNULLO).toContain('coupon_code');
  });
});

describe('annullare lo stesso ordine due volte', () => {
  it('IL CASO CHE ROMPEVA — il secondo annullo non accredita e non gonfia il magazzino', async () => {
    stato.righePrese = []; // un altro percorso ha già preso il turno sull'ordine

    const esito = await annullaERimborsa(adminFinto, ordine(), { reason: 'annullato' });

    expect(esito).toEqual({ ok: false, motivo: 'GIA_ANNULLATO' });
    expect(
      chiamate('wallet_credit'),
      'credito accreditato una seconda volta: sono 50 € regalati su un ordine solo',
    ).toHaveLength(0);
    expect(
      chiamate('restore_stock_for_order'),
      'merce rimessa a magazzino due volte: il negozio venderà pezzi che non ha',
    ).toHaveLength(0);
    expect(chiamate('release_coupon')).toHaveLength(0);
  });

  it('il primo annullo passa e fa tutto quello che deve', async () => {
    const esito = await annullaERimborsa(adminFinto, ordine(), { reason: 'annullato' });
    expect(esito).toEqual({ ok: true, refundId: null });
    expect(chiamate('wallet_credit')).toHaveLength(1);
    expect(chiamate('restore_stock_for_order')).toHaveLength(1);
  });
});

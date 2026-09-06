import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 6/9/2026 — UN CARRELLO DA DUE NEGOZI RESTITUIVA IL CODICE SCONTO PER INTERO.
 *
 * In cassa il codice si rivendica UNA volta per carrello (`claim_coupon`). Ma un
 * carrello con due negozi diventa DUE ordini, e tutti e due portano scritto
 * `coupon_code`. Bastava che il fornaio rifiutasse il suo — prodotto finito, il
 * caso più normale del primo mese — e `release_coupon` rimetteva in circolo
 * l'uso, mentre l'ordine del fioraio teneva lo sconto e andava a buon fine.
 *
 * Il conto: un codice monouso torna riutilizzabile, e una campagna «sconto ai
 * primi 50» ne regala più di 50. Non è un errore che si vede: si vede solo il
 * contatore `uses_count` che non torna con gli ordini.
 *
 * La cura: si restituisce solo quando NESSUN altro ordine vivo dello stesso
 * carrello porta ancora quel codice. Il carrello, per gli ordini con carta, è la
 * sessione di pagamento (`stripe_session_id`).
 *
 * ⚪ Limite dichiarato e provato qui sotto: sul pagamento alla consegna il
 * carrello non ha una targa sulle righe dell'ordine, quindi lì si restituisce
 * come prima. Chiuderlo vuole una migrazione (una colonna «carrello» sugli
 * ordini), che è una firma a parte.
 */

const refundOrderMock = vi.fn(async () => ({ refundId: 're_1', reversedCents: 0 }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: () => refundOrderMock() }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { annullaERimborsa, COLONNE_ANNULLO, type OrdineDaAnnullare } from '@/lib/ordini/annulla';

type RigaOrdine = { id: string; stripe_session_id: string | null; coupon_code: string | null; delivery_status: string };

const stato: {
  /** Gli altri ordini che il database contiene. */
  ordini: RigaOrdine[];
  /** La lettura dei fratelli fallisce (rete, permessi). */
  letturaRotta: boolean;
  rpc: Array<{ nome: string; args: Record<string, unknown> }>;
} = { ordini: [], letturaRotta: false, rpc: [] };

/**
 * Finto database: sa fare la rivendicazione dell'annullo (update) e la domanda
 * nuova, «c'è un altro ordine di questo carrello che tiene il codice?» (select
 * con i filtri veri).
 */
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
    select: () => {
      const filtri: { uguali: Record<string, unknown>; diversi: Record<string, unknown> } = { uguali: {}, diversi: {} };
      const catena: Record<string, unknown> = {
        eq: (campo: string, valore: unknown) => { filtri.uguali[campo] = valore; return catena; },
        neq: (campo: string, valore: unknown) => { filtri.diversi[campo] = valore; return catena; },
        limit: () => {
          if (stato.letturaRotta) return Promise.resolve({ data: null, error: { message: 'niente rete' } });
          const trovati = stato.ordini.filter(
            (o) =>
              o.stripe_session_id === filtri.uguali.stripe_session_id &&
              o.coupon_code === filtri.uguali.coupon_code &&
              o.id !== filtri.diversi.id &&
              o.delivery_status !== filtri.diversi.delivery_status,
          );
          return Promise.resolve({ data: trovati.map((o) => ({ id: o.id })), error: null });
        },
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

function ordineDelFornaio(p: Partial<OrdineDaAnnullare> = {}): OrdineDaAnnullare {
  return {
    id: 'ordine-fornaio',
    user_id: 'u1',
    seller_id: 'fornaio',
    total_price: 24,
    payment_method: 'card',
    payment_status: 'PAID',
    delivery_status: 'NEW',
    stripe_payment_intent: 'pi_1',
    wallet_applied_cents: 0,
    cash_confirmed_at: null,
    refunded_amount_cents: 0,
    coupon_code: 'PRIMI50',
    stripe_session_id: 'cs_carrello_1',
    ...p,
  };
}

const restituzioni = () => stato.rpc.filter((c) => c.nome === 'release_coupon');

beforeEach(() => {
  stato.ordini = [];
  stato.letturaRotta = false;
  stato.rpc = [];
  refundOrderMock.mockClear();
});

describe('il codice sconto di un carrello con due negozi', () => {
  it('IL CASO CHE ROMPEVA — non torna in circolo se l altro ordine lo tiene ancora', async () => {
    stato.ordini = [
      { id: 'ordine-fioraio', stripe_session_id: 'cs_carrello_1', coupon_code: 'PRIMI50', delivery_status: 'ACCEPTED' },
    ];

    const esito = await annullaERimborsa(adminFinto, ordineDelFornaio(), { reason: 'rifiutato dal negozio' });

    expect(esito.ok, 'il rifiuto deve comunque riuscire: i soldi tornano al cliente').toBe(true);
    expect(
      restituzioni(),
      'il codice è tornato utilizzabile mentre l ordine del fioraio teneva ancora lo sconto: un monouso usato due volte',
    ).toHaveLength(0);
  });

  it('torna quando se ne va anche l ultimo ordine del carrello', async () => {
    stato.ordini = [
      { id: 'ordine-fioraio', stripe_session_id: 'cs_carrello_1', coupon_code: 'PRIMI50', delivery_status: 'CANCELED' },
    ];

    await annullaERimborsa(adminFinto, ordineDelFornaio(), { reason: 'rifiutato dal negozio' });

    expect(
      restituzioni(),
      'nessun ordine vivo tiene più il codice: il cliente deve riaverlo',
    ).toHaveLength(1);
    expect(restituzioni()[0].args).toMatchObject({ p_code: 'PRIMI50', p_order_id: 'ordine-fornaio' });
  });

  it('un ordine di un ALTRO carrello non blocca la restituzione', async () => {
    stato.ordini = [
      { id: 'ordine-di-domani', stripe_session_id: 'cs_carrello_2', coupon_code: 'PRIMI50', delivery_status: 'NEW' },
    ];

    await annullaERimborsa(adminFinto, ordineDelFornaio(), { reason: 'annullato' });

    expect(restituzioni(), 'il buono è rimasto bruciato per colpa di un altro carrello').toHaveLength(1);
  });

  it('carrello di un solo negozio: niente fratelli, il buono torna come prima', async () => {
    await annullaERimborsa(adminFinto, ordineDelFornaio(), { reason: 'annullato' });
    expect(restituzioni()).toHaveLength(1);
  });

  it('se la lettura dei fratelli non riesce, il cliente non ci rimette il buono', async () => {
    stato.letturaRotta = true;
    await annullaERimborsa(adminFinto, ordineDelFornaio(), { reason: 'annullato' });
    expect(
      restituzioni(),
      'davanti a un dubbio si preferisce un uso in più a un cliente che perde il buono senza aver comprato',
    ).toHaveLength(1);
  });

  it('sul pagamento alla consegna si restituisce come prima: il carrello non ha targa', async () => {
    await annullaERimborsa(
      adminFinto,
      ordineDelFornaio({ payment_method: 'cod', payment_status: 'PENDING', stripe_payment_intent: null, stripe_session_id: null }),
      { reason: 'annullato' },
    );
    expect(restituzioni(), 'il buono di chi paga alla consegna deve tornare, come prima').toHaveLength(1);
  });

  it('la targa del carrello è fra le colonne lette: senza, il dato non arriva nemmeno', () => {
    expect(COLONNE_ANNULLO).toContain('stripe_session_id');
  });
});

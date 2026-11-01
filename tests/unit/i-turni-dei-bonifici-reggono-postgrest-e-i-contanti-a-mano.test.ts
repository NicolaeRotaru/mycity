import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 31/10/2026 (ondata 5, pacchetto «lib/stripe/payout.ts») — TRE MODI IN CUI UN
 * BONIFICO SI FERMAVA, O PARTIVA DUE VOLTE.
 *
 * Girano sul finto che si comporta come PostgREST (`finto-database-dei-pagamenti.ts`,
 * contratto in `il-finto-database-si-comporta-come-postgrest.test.ts`):
 *
 *  ① il turno del fattorino era UNA scrittura con un «oppure» e `.select('id')`:
 *    PostgREST applica l'«oppure» anche alle righe restituite, che non portano
 *    `rider_payout_status`, e risponde 42703 senza scrivere. Il compenso con
 *    carta finiva in TRANSFER_FAILED ogni volta.
 *  ② su un database senza la migrazione 126 (la produzione di oggi) il turno
 *    scrive `payout_claimed_at`, PostgREST risponde PGRST204, e il ripiego non
 *    lo riconosceva perché guardava solo le colonne della 124.
 *  ③ i contrassegni pagati a mano da Nicola restano HELD: il giorno che si
 *    accende Stripe il giro li pagava una seconda volta dal saldo della piattaforma.
 */

let finto: FintoDatabase;
const transfersCreate = vi.fn(async (_corpo: Record<string, unknown>, _opz?: unknown) => ({ id: 'tr_nuovo' }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ transfers: { create: transfersCreate, list: async () => ({ data: [] }) } }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

import { releaseOrderPayout, releaseRiderPayout } from '@/lib/stripe/payout';
import { eSchemaIndietro } from '@/lib/db/migrazione-124';

const VAR = 'PAGAMENTI_CONTANTI_DA_STRIPE_DAL';

function ordineDelFattorino(extra: Riga = {}): Riga {
  return {
    id: 'o_r', rider_id: 'r1', payment_method: 'card', delivery_status: 'DELIVERED',
    rider_payout_status: null, rider_fee_cents: 400, rider_payout_tentativo: 0, shipping_cost: 4,
    stripe_charge_id: 'ch_r', stripe_transfer_group: 'order_o_r', total_price: 20,
    pickup_in_store: false, cash_confirmed_at: null, rider_payout_claimed_at: null, ...extra,
  };
}

function ordineDelNegozio(extra: Riga = {}): Riga {
  return {
    id: 'o_s', seller_id: 's1', payout_status: 'HELD', delivery_status: 'DELIVERED',
    payment_method: 'card', delivered_at: '2026-11-10T10:00:00.000Z',
    seller_payout_cents: 13500, seller_payout_reversed_cents: 0, payout_tentativo: 0,
    stripe_charge_id: 'ch_s', stripe_transfer_group: 'order_o_s', payout_claimed_at: null, ...extra,
  };
}

function preparaDatabase(ordine: Riga): void {
  finto = fintoDatabase({
    orders: [ordine],
    profiles: [
      { id: 's1', stripe_account_id: 'acct_s1', stripe_payouts_enabled: true },
      { id: 'r1', stripe_account_id: 'acct_r1', stripe_payouts_enabled: true },
    ],
  });
}

beforeEach(() => {
  transfersCreate.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('il compenso del fattorino pagato con carta', () => {
  it('parte quando non e mai stato provato (stato vuoto)', async () => {
    preparaDatabase(ordineDelFattorino());
    const esito = await releaseRiderPayout('o_r');
    expect(esito, 'il turno si ferma su PostgREST: il fattorino non riceve il compenso').toEqual({ ok: true, transferId: 'tr_nuovo' });
    expect(transfersCreate).toHaveBeenCalledTimes(1);
    expect(finto.tabelle.orders[0].rider_payout_status).toBe('TRANSFERRED');
  });

  it('riparte da un tentativo fallito', async () => {
    preparaDatabase(ordineDelFattorino({ rider_payout_status: 'FAILED' }));
    const esito = await releaseRiderPayout('o_r');
    expect(esito.ok, 'un compenso FAILED non si ritenta').toBe(true);
    expect(transfersCreate).toHaveBeenCalledTimes(1);
  });

  it('non parte se un altro giro ha gia il turno', async () => {
    preparaDatabase(ordineDelFattorino({ rider_payout_status: 'PROCESSING' }));
    const esito = await releaseRiderPayout('o_r');
    expect(esito).toMatchObject({ ok: false, code: 'BAD_STATE' });
    expect(transfersCreate).not.toHaveBeenCalled();
  });

  it('parte anche su un database senza la migrazione 126', async () => {
    preparaDatabase(ordineDelFattorino());
    finto.colonneMancanti = { orders: ['payout_claimed_at', 'rider_payout_claimed_at'] };
    const esito = await releaseRiderPayout('o_r');
    expect(esito.ok, 'senza la 126 il ripiego non scatta e il compenso resta fermo').toBe(true);
    expect(transfersCreate).toHaveBeenCalledTimes(1);
  });
});

describe('il bonifico al negozio su un database senza la migrazione 126', () => {
  it('parte lo stesso: il ripiego toglie l ora del turno', async () => {
    preparaDatabase(ordineDelNegozio());
    finto.colonneMancanti = { orders: ['payout_claimed_at', 'rider_payout_claimed_at'] };
    const esito = await releaseOrderPayout('o_s');
    expect(esito, 'PGRST204 su payout_claimed_at non riconosciuto: ogni bonifico in TRANSFER_FAILED').toEqual({ ok: true, transferId: 'tr_nuovo' });
    expect(finto.tabelle.orders[0].payout_status).toBe('TRANSFERRED');
  });

  it('una colonna sconosciuta resta un errore vero, non «schema indietro»', () => {
    const errore = { code: 'PGRST204', message: "Could not find the 'payout_claimed_at_bis' column of 'orders' in the schema cache" };
    expect(eSchemaIndietro(errore)).toBe(false);
    expect(eSchemaIndietro({ ...errore, message: "Could not find the 'payout_claimed_at' column of 'orders' in the schema cache" })).toBe(true);
  });
});

describe('i contrassegni gia pagati a mano al negozio', () => {
  const contanti = { payment_method: 'cod', stripe_charge_id: null, delivered_at: '2026-11-10T10:00:00.000Z' };

  it('senza la data d inizio, Stripe non paga nessun contrassegno', async () => {
    preparaDatabase(ordineDelNegozio(contanti));
    const esito = await releaseOrderPayout('o_s');
    expect(esito, 'il forno riceve una seconda volta i soldi che Nicola gli ha gia girato').toMatchObject({ ok: false, code: 'BAD_STATE' });
    expect(transfersCreate).not.toHaveBeenCalled();
    expect(finto.tabelle.orders[0].payout_status).toBe('HELD');
  });

  it('consegnato prima della data d inizio: resta a mano', async () => {
    vi.stubEnv(VAR, '2026-12-01');
    preparaDatabase(ordineDelNegozio(contanti));
    const esito = await releaseOrderPayout('o_s');
    expect(esito.ok).toBe(false);
    expect(transfersCreate).not.toHaveBeenCalled();
  });

  it('con una data storta non parte niente', async () => {
    vi.stubEnv(VAR, 'dicembre');
    preparaDatabase(ordineDelNegozio(contanti));
    expect((await releaseOrderPayout('o_s')).ok).toBe(false);
    expect(transfersCreate).not.toHaveBeenCalled();
  });

  it('consegnato dalla data d inizio in poi: lo paga Stripe', async () => {
    vi.stubEnv(VAR, '2026-11-01');
    preparaDatabase(ordineDelNegozio(contanti));
    const esito = await releaseOrderPayout('o_s');
    expect(esito).toEqual({ ok: true, transferId: 'tr_nuovo' });
    expect(transfersCreate).toHaveBeenCalledTimes(1);
  });

  it('la carta non cambia: si paga anche senza la data', async () => {
    preparaDatabase(ordineDelNegozio());
    expect((await releaseOrderPayout('o_s')).ok).toBe(true);
  });
});

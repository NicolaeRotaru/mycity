import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoDatabase, TIMEOUT, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * LA CONTESTAZIONE PARZIALE VINTA NON RIFÀ IL BONIFICO QUANDO LA CHIAVE DI STRIPE È SCADUTA.
 *
 * La chiave anti-doppione di Stripe vale 24 ore; Stripe ripete l'evento per 3 giorni. Se la
 * scrittura dopo il bonifico continua a fallire, la ripetizione di due giorni dopo arrivava con
 * la stessa chiave ma scaduta: Stripe faceva un secondo bonifico da 18 € al negozio.
 * Lo Stripe finto qui sotto si comporta così: la chiave ritorna lo stesso bonifico solo entro 24 ore.
 */

type Bonifico = { id: string; amount: number; destination: string; transfer_group: string; metadata: Record<string, string> };
const VENTIQUATTRO_ORE = 24 * 60 * 60 * 1000;

const stato: {
  db: FintoDatabase;
  bonifici: Bonifico[];
  chiavi: Map<string, { bonifico: Bonifico; quando: number }>;
  elencoGuasto: boolean;
} = { db: fintoDatabase(), bonifici: [], chiavi: new Map(), elencoGuasto: false };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    transfers: {
      create: async (
        params: { amount: number; destination: string; transfer_group: string; metadata: Record<string, string> },
        opzioni: { idempotencyKey: string },
      ) => {
        const gia = stato.chiavi.get(opzioni.idempotencyKey);
        if (gia && Date.now() - gia.quando < VENTIQUATTRO_ORE) return gia.bonifico;
        const nuovo: Bonifico = {
          id: `tr_rest_${stato.bonifici.length + 1}`,
          amount: params.amount,
          destination: params.destination,
          transfer_group: params.transfer_group,
          metadata: params.metadata,
        };
        stato.bonifici.push(nuovo);
        stato.chiavi.set(opzioni.idempotencyKey, { bonifico: nuovo, quando: Date.now() });
        return nuovo;
      },
      list: async (params: { transfer_group: string }) => {
        if (stato.elencoGuasto) throw new Error('Stripe non risponde');
        return { data: stato.bonifici.filter((b) => b.transfer_group === params.transfer_group) };
      },
    },
  }),
  isStripeConfigured: () => true,
}));

import { restituisciLeQuoteParziali } from '@/lib/stripe/webhook/contestazione-parziale-vinta';

/** Ordine da 50 €, 45 € al negozio già versati, contestati 20 €: all'apertura stornati 18 €. */
function ordineContestato(extra: Riga = {}): Riga {
  return {
    id: 'o1',
    seller_id: 's1',
    payout_status: 'TRANSFERRED',
    seller_payout_cents: 4500,
    seller_payout_reversed_cents: 1800,
    dispute_seller_reversed_cents: 1800,
    stripe_charge_id: 'ch_1',
    stripe_transfer_group: 'order_o1',
    payout_tentativo: 0,
    ...extra,
  };
}

const contestazione = { id: 'dp_p', amount: 2000, status: 'won' } as never;
const ordine = () => stato.db.tabelle.orders.find((r) => r.id === 'o1')!;
const scritturaOrdini = (s: { tabella: string; operazione: string }) => s.tabella === 'orders' && s.operazione === 'update';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
  stato.bonifici = [];
  stato.chiavi = new Map();
  stato.elencoGuasto = false;
  stato.db = fintoDatabase({
    orders: [ordineContestato()],
    profiles: [{ id: 'admin1', role: 'admin' }, { id: 's1', role: 'seller', stripe_account_id: 'acct_s1' }],
    notifications: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('contestazione parziale vinta: la ripetizione dopo la scadenza della chiave', () => {
  it('lo stesso evento due giorni dopo, con la scrittura caduta la prima volta: un solo bonifico', async () => {
    stato.db.guasto = (s) => (scritturaOrdini(s) ? TIMEOUT : null);
    await expect(restituisciLeQuoteParziali(contestazione, [{ ...ordine() } as never])).rejects.toThrow();
    expect(stato.bonifici).toHaveLength(1);
    expect(ordine().dispute_seller_reversed_cents, 'la scrittura è caduta: il promemoria resta').toBe(1800);

    // Stripe ripete l'evento due giorni dopo: la chiave di 24 ore è scaduta, il database risponde.
    vi.setSystemTime(new Date('2026-11-29T10:00:00Z'));
    stato.db.guasto = () => null;
    await restituisciLeQuoteParziali(contestazione, [{ ...ordine() } as never]);

    expect(stato.bonifici, 'un secondo bonifico da 18 € al negozio').toHaveLength(1);
    expect(stato.bonifici[0]).toMatchObject({ amount: 1800, destination: 'acct_s1' });
    expect(ordine()).toMatchObject({ seller_payout_reversed_cents: 0, dispute_seller_reversed_cents: 0, payout_tentativo: 1 });
  });

  it('la restituzione di un altra contestazione sullo stesso ordine non ferma questa', async () => {
    stato.bonifici.push({
      id: 'tr_altra', amount: 500, destination: 'acct_s1', transfer_group: 'order_o1',
      metadata: { order_id: 'o1', kind: 'dispute_won_restore', dispute_id: 'dp_vecchia', tentativo: 'restituzione_1' },
    });
    await restituisciLeQuoteParziali(contestazione, [{ ...ordine() } as never]);
    expect(stato.bonifici.map((b) => b.id)).toEqual(['tr_altra', 'tr_rest_2']);
    expect(ordine().dispute_seller_reversed_cents).toBe(0);
  });

  it('con l elenco di Stripe che non risponde, la prima restituzione parte comunque (resta la chiave)', async () => {
    stato.elencoGuasto = true;
    await restituisciLeQuoteParziali(contestazione, [{ ...ordine() } as never]);
    expect(stato.bonifici).toHaveLength(1);
    expect(ordine()).toMatchObject({ seller_payout_reversed_cents: 0, dispute_seller_reversed_cents: 0 });
  });
});

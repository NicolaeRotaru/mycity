import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, TIMEOUT, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * R28-015 — Se la banca respinge un rimborso parziale su un ordine col bonifico già partito, al negozio
 * restava tolta la sua quota.
 *
 * Ordine da 20 € con 16 € al negozio già versati ('TRANSFERRED'). Dal cruscotto escono 5 €: la quota
 * del negozio (4 €) si riprende con uno storno sul suo bonifico. Poi la banca del cliente respinge il
 * rimborso e i 5 € tornano a MyCity. Prima: il cliente tornava «pagato», ma al negozio nessuno ridava
 * i 4 €, e lo stornato sull'ordine restava 4 €. Adesso gli tornano con un bonifico nuovo, sulla chiave
 * `riaccredito_<id del rimborso>`, una volta sola anche se l'avviso arriva due volte.
 *
 * Gira il gestore VERO dell'avviso, su un database finto che applica i filtri come PostgREST. Stripe è
 * finto: tiene i bonifici fatti e, come quello vero, con la stessa chiave restituisce lo stesso bonifico.
 */

type Bonifico = { id: string; amount: number; destination: string; chiave: string; parametri: Record<string, unknown> };

const stato: { db: FintoDatabase; chiamate: Bonifico[]; bonifici: Map<string, Bonifico> } = {
  db: fintoDatabase(),
  chiamate: [],
  bonifici: new Map(),
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    transfers: {
      create: async (p: Record<string, unknown>, o: { idempotencyKey?: string }) => {
        const chiave = o?.idempotencyKey ?? '';
        const visto = stato.bonifici.get(chiave);
        const chiamata = { id: visto?.id ?? `tr_nuovo_${stato.bonifici.size + 1}`, amount: Number(p.amount), destination: String(p.destination), chiave, parametri: p };
        stato.chiamate.push(chiamata);
        if (visto) {
          if (JSON.stringify(visto.parametri) !== JSON.stringify(p)) throw new Error('Keys for idempotent requests can only be used with the same parameters');
          return { id: visto.id, amount: visto.amount };
        }
        stato.bonifici.set(chiave, chiamata);
        return { id: chiamata.id, amount: chiamata.amount };
      },
    },
  }),
}));

import { handleRefundUpdated } from '@/lib/stripe/webhook/rimborsi';

function ordineGiaPagatoAlNegozio(extra: Riga = {}): Riga {
  return {
    id: 'o1',
    seller_id: 'negozio1',
    total_price: 20,
    gross_total_cents: 2000,
    seller_payout_cents: 1600,
    refunded_amount_cents: 500,
    payment_status: 'PARTIALLY_REFUNDED',
    payout_status: 'TRANSFERRED',
    stripe_payment_intent: 'pi_1',
    stripe_charge_id: 'ch_1',
    stripe_transfer_group: 'grp_o1',
    stripe_transfer_id: 'tr_bonifico',
    stripe_reversal_id: 'trr_storno',
    seller_payout_reversed_cents: 400,
    payout_tentativo: 1,
    stripe_refund_id: 're_cruscotto',
    reversal_error: null,
    internal_dispute_status: null,
    ...extra,
  };
}

const respinto = (id = 're_cruscotto', centesimi = 500) =>
  ({ id, amount: centesimi, status: 'failed', payment_intent: 'pi_1', metadata: {} }) as unknown as Parameters<typeof handleRefundUpdated>[0];

const ordine = () => stato.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const avvisiAMano = () => stato.db.tabelle.notifications!.filter((n) => String(n.title).includes('da restituire a mano'));

beforeEach(() => {
  stato.chiamate = [];
  stato.bonifici = new Map();
  stato.db = fintoDatabase({
    orders: [ordineGiaPagatoAlNegozio()],
    profiles: [{ id: 'admin1', role: 'admin' }, { id: 'negozio1', role: 'seller', stripe_account_id: 'acct_negozio' }],
    notifications: [],
  });
});

describe('R28-015 · il rimborso parziale respinto col bonifico già partito', () => {
  it('IL CASO DELLA VOCE — al negozio tornano i suoi 4 € con un bonifico, e lo stornato scende di 4 €', async () => {
    await handleRefundUpdated(respinto());

    expect(stato.bonifici.size, 'un bonifico nuovo al negozio').toBe(1);
    const [bonifico] = [...stato.bonifici.values()];
    expect(bonifico).toMatchObject({ amount: 400, destination: 'acct_negozio', chiave: 'riaccredito_re_cruscotto' });
    expect(bonifico.parametri).toMatchObject({ currency: 'eur', transfer_group: 'grp_o1', source_transaction: 'ch_1' });
    expect(ordine()).toMatchObject({
      refunded_amount_cents: 0, payment_status: 'PAID', payout_status: 'TRANSFERRED', seller_payout_reversed_cents: 0,
    });
    expect(avvisiAMano()).toEqual([]);
  });

  it('due avvisi uguali fanno un solo bonifico, sulla chiave riaccredito_<id del rimborso>', async () => {
    await handleRefundUpdated(respinto());
    await handleRefundUpdated(respinto());

    expect(stato.chiamate.map((c) => c.chiave), 'il secondo avviso trova il segno «respinto» e non chiede niente a Stripe').toEqual(['riaccredito_re_cruscotto']);
    expect(stato.bonifici.size).toBe(1);
    expect(ordine().seller_payout_reversed_cents, 'non scende due volte').toBe(0);
    expect(ordine().refunded_amount_cents).toBe(0);
  });

  it('la scrittura dopo il bonifico cade: Stripe riprova, la stessa chiave restituisce lo stesso bonifico', async () => {
    let caduta = false;
    stato.db.guasto = (s) => {
      if (!caduta && s.tabella === 'orders' && s.operazione === 'update') { caduta = true; return TIMEOUT; }
      return null;
    };
    await expect(handleRefundUpdated(respinto()), 'il database ha detto di no: Stripe deve riprovare').rejects.toThrow();
    expect(ordine().seller_payout_reversed_cents, 'niente scritto al primo passaggio').toBe(400);

    await handleRefundUpdated(respinto());

    expect(stato.chiamate.map((c) => c.chiave)).toEqual(['riaccredito_re_cruscotto', 'riaccredito_re_cruscotto']);
    expect(stato.bonifici.size, 'due richieste, un bonifico solo').toBe(1);
    expect(ordine()).toMatchObject({ refunded_amount_cents: 0, seller_payout_reversed_cents: 0 });
  });

  it('negozio senza conto collegato: niente bonifico, lo stornato resta e gli amministratori hanno la cifra da ridare a mano', async () => {
    stato.db.tabelle.profiles = [{ id: 'admin1', role: 'admin' }, { id: 'negozio1', role: 'seller', stripe_account_id: null }];
    await handleRefundUpdated(respinto());

    expect(stato.chiamate).toEqual([]);
    expect(ordine(), 'il cliente torna a posto lo stesso').toMatchObject({ refunded_amount_cents: 0, payment_status: 'PAID', seller_payout_reversed_cents: 400 });
    expect(avvisiAMano()).toHaveLength(1);
    expect(String(avvisiAMano()[0].body)).toMatch(/4,00/);
  });

  it('se lo storno non c’è mai stato (stornato 0), al negozio non si ridà niente', async () => {
    stato.db.tabelle.orders = [ordineGiaPagatoAlNegozio({ seller_payout_reversed_cents: 0 })];
    await handleRefundUpdated(respinto());

    expect(stato.chiamate).toEqual([]);
    expect(ordine()).toMatchObject({ refunded_amount_cents: 0, seller_payout_reversed_cents: 0 });
    expect(avvisiAMano()).toEqual([]);
  });
});

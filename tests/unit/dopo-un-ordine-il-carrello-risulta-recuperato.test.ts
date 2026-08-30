import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/8/2026 (R164) — E IL SERVER LO SCRIVE ANCHE SE IL BROWSER SE NE VA.
 *
 * Il carrello che diventa ordine va marcato come recuperato, altrimenti la
 * campagna «hai dimenticato qualcosa» non si può misurare (vedi
 * il-carrello-che-torna-si-vede-nei-numeri.test.ts per il lato browser).
 *
 * Ma il browser può chiudersi: chi paga con la carta ed esce dalla scheda non
 * torna mai sulla pagina che svuota il carrello. Il posto dove l'ordine è un
 * fatto certo è il webhook di Stripe, e lì la riga va marcata comunque.
 *
 * Qui si fa girare la gestione vera dell'evento «pagamento riuscito» su un
 * finto database che si ricorda cosa gli è stato scritto.
 */

const scritture: Array<{ tabella: string; valori: Record<string, unknown> }> = [];

vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => { void fn; },
  NextResponse: { json: (b: unknown, i?: ResponseInit) => new Response(JSON.stringify(b), i) },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true }) }));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
  newOrderSellerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
}));
vi.mock('@/lib/analytics/server', () => ({
  analyticsConsentita: async () => true,
  contaAcquisto: async () => {},
}));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ paymentIntents: { retrieve: async () => ({ latest_charge: 'ch_1' }) } }),
  computeOrderSplit: () => ({ applicationFeeCents: 100, sellerPayoutCents: 900 }),
}));

const PENDING = {
  id: 'pc_1',
  buyer_id: 'buyer-1',
  status: 'PENDING',
  total_cents: 1000,
  stripe_session_id: 'cs_1',
  coupon_code: null,
  pickup_in_store: false,
  delivery: { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: null },
  groups: [{ sellerId: 'seller-1', storeName: 'Pane Quotidiano', totalCents: 1000, shippingCents: 0, deliveryFeeCents: 0, riderFeeCents: 100, couponPortionCents: 0, pickupPortionCents: 0, items: [{ productId: 'p1', quantity: 2, unitAmountCents: 500 }] }],
};

/** Catena di filtri che accetta qualunque `.eq()` e finisce sempre bene. */
function filtri() {
  const c: Record<string, unknown> = {};
  for (const m of ['eq', 'in', 'is', 'lt', 'select']) c[m] = () => c;
  c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r);
  return c;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          single: async () => ({ data: PENDING, error: null }),
          maybeSingle: async () => ({ data: PENDING, error: null }),
        }),
      }),
      insert: () => {
        const esito = { data: { id: 'o1' }, error: null };
        return {
          select: () => ({ single: async () => esito }),
          then: (r: (v: { error: null }) => unknown) => r({ error: null }),
        };
      },
      update: (valori: Record<string, unknown>) => {
        scritture.push({ tabella, valori });
        return filtri();
      },
      delete: () => filtri(),
    }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
  }),
}));

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';

const sessione = {
  id: 'cs_1',
  payment_status: 'paid',
  client_reference_id: 'pc_1',
  amount_total: 1000,
  payment_intent: 'pi_1',
  customer_details: { email: 'cliente@test.it', name: 'Maria Rossi' },
  metadata: {},
} as never;

beforeEach(() => {
  scritture.length = 0;
});

describe('il webhook della carta marca il carrello come recuperato', () => {
  it('a ordine scritto, la riga del carrello abbandonato risulta tornata', async () => {
    await handleCheckoutCompleted(sessione);

    const marcatura = scritture.find((s) => s.tabella === 'abandoned_carts');
    expect(
      marcatura,
      'chi paga e chiude la scheda non passa dal browser che marca: qui il recupero non lo registra nessuno',
    ).toBeTruthy();
    expect(marcatura?.valori.recovered).toBe(true);
    expect(marcatura?.valori.recovered_at).toBeTruthy();
  });
});

/**
 * E le righe recuperate non restano lì per sempre.
 *
 * Da oggi la riga di un carrello diventato ordine non si cancella più: si
 * marca, altrimenti la campagna non si può misurare. Ma «non si cancella più»
 * senza un taglio vuol dire tenere la spesa di una persona a tempo
 * indeterminato, e per quello non c'è nessun motivo. Il giro orario dei
 * carrelli abbandonati pota le righe recuperate più vecchie della memoria
 * dichiarata.
 */
describe('la potatura delle righe gia recuperate', () => {
  type Filtro = { colonna: string; valore: unknown };

  function finto(righe: Array<{ user_id: string; recovered: boolean; recovered_at: string | null }>) {
    const eq: Filtro[] = [];
    const lt: Filtro[] = [];
    const c: Record<string, unknown> = {
      delete: () => c,
      eq: (colonna: string, valore: unknown) => { eq.push({ colonna, valore }); return c; },
      lt: (colonna: string, valore: unknown) => { lt.push({ colonna, valore }); return c; },
      select: () => c,
      then: (risolvi: (v: unknown) => unknown) => {
        const restano = righe.filter(
          (r) =>
            eq.every((f) => (r as unknown as Record<string, unknown>)[f.colonna] === f.valore) &&
            lt.every((f) => r.recovered_at != null && r.recovered_at < (f.valore as string)),
        );
        return Promise.resolve({ data: restano, error: null }).then(risolvi);
      },
    };
    return { from: () => c };
  }

  it('taglia solo le recuperate vecchie, e lascia stare tutte le altre', async () => {
    const { potaCarrelliRecuperati, GIORNI_DI_MEMORIA_CARRELLI } = await import('@/lib/carrelli-abbandonati');
    const ora = Date.UTC(2026, 7, 30);
    const giorniFa = (g: number) => new Date(ora - g * 86_400_000).toISOString();

    const righe = [
      { user_id: 'vecchia', recovered: true, recovered_at: giorniFa(GIORNI_DI_MEMORIA_CARRELLI + 1) },
      { user_id: 'fresca', recovered: true, recovered_at: giorniFa(2) },
      // Un carrello ancora abbandonato: quello serve, non si tocca mai.
      { user_id: 'in-attesa', recovered: false, recovered_at: null },
    ];

    const quante = await potaCarrelliRecuperati(
      finto(righe) as unknown as Parameters<typeof potaCarrelliRecuperati>[0],
      ora,
    );
    expect(quante, 'la potatura porta via anche i carrelli ancora da recuperare, o non porta via niente').toBe(1);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/8/2026 (R005) — UN INTOPPO SUL PRIMO NEGOZIO E GLI ALTRI NON SAPEVANO
 * DI AVERE UN ORDINE.
 *
 * Le due strade che creano un ordine fanno lo stesso lavoro finale — mail al
 * cliente, mail al negoziante — ma lo proteggevano in modo diverso. La strada
 * dei contanti mette ogni invio nel suo try/catch: se salta il primo, il
 * secondo parte lo stesso. La strada della carta no: il ciclo
 * `for (const created of nuovi)` stava dentro un'unica funzione rimandata, con
 * un solo `.catch()` in fondo. La prima cosa che lanciava interrompeva il ciclo
 * per TUTTI gli ordini successivi.
 *
 * Cosa vuol dire per una persona: carrello da due o tre negozi pagato con
 * carta, qualcosa si inceppa sul primo invio, e il secondo e il terzo
 * negoziante non ricevono la mail. Il pagamento invece e' andato: il cliente ha
 * pagato e aspetta la spesa che nessuno sta preparando.
 *
 * L'innesco non era teorico: `sendEmail` puo' lanciare (Resend che rifiuta in
 * modo inatteso, la lettura dell'utente venditore che va storta), e ogni lancio
 * si portava dietro tutti gli ordini dopo.
 *
 * QUESTA PROVA ESEGUE il caso: due negozi, il primo invio lancia, e si guarda
 * chi resta senza avviso.
 */

const dopoLaRisposta: Array<() => Promise<void>> = [];
vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => { dopoLaRisposta.push(fn); },
  NextResponse: { json: (b: unknown, i?: ResponseInit) => new Response(JSON.stringify(b), i) },
}));

const emailSpedite: string[] = [];
/** Indirizzi su cui l'invio deve lanciare (il guasto che si vuole provare). */
const indirizziGuasti = new Set<string>();

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string }) => {
    if (indirizziGuasti.has(m.to)) throw new Error(`invio non riuscito verso ${m.to}`);
    emailSpedite.push(m.to);
    return { ok: true };
  },
}));
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

/** Carrello da DUE negozi: e' il caso in cui il difetto si vede. */
const gruppo = (n: number) => ({
  sellerId: `seller-${n}`,
  storeName: `Negozio ${n}`,
  totalCents: 1000,
  shippingCents: 0,
  deliveryFeeCents: 0,
  riderFeeCents: 100,
  couponPortionCents: 0,
  pickupPortionCents: 0,
  items: [{ productId: `p${n}`, quantity: 1, unitAmountCents: 1000 }],
});

const PENDING = {
  id: 'pc_1',
  buyer_id: 'buyer-1',
  status: 'PENDING',
  total_cents: 2000,
  stripe_session_id: 'cs_1',
  coupon_code: null,
  pickup_in_store: false,
  delivery: { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: null },
  groups: [gruppo(1), gruppo(2)],
};

let ordiniCreati = 0;

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          single: async () => ({ data: PENDING, error: null }),
          maybeSingle: async () => ({ data: PENDING, error: null }),
          then: undefined,
        }),
      }),
      insert: () => {
        ordiniCreati += 1;
        const esito = { data: { id: `o${ordiniCreati}` }, error: null };
        return {
          select: () => ({ single: async () => esito }),
          then: (r: (v: { error: null }) => unknown) => r({ error: null }),
        };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { email: `${id}@negozio.test` } } }),
      },
    },
  }),
}));

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';

const sessione = {
  id: 'cs_1',
  payment_status: 'paid',
  client_reference_id: 'pc_1',
  amount_total: 2000,
  payment_intent: 'pi_1',
  customer_details: { email: 'cliente@test.it', name: 'Maria Rossi' },
  metadata: {},
} as never;

beforeEach(() => {
  emailSpedite.length = 0;
  indirizziGuasti.clear();
  dopoLaRisposta.length = 0;
  ordiniCreati = 0;
});

async function eseguiIlLavoroRimandato() {
  for (const lavoro of dopoLaRisposta) await lavoro();
}

describe('gli avvisi post-ordine con la carta', () => {
  it('quando tutto va bene ogni negozio del carrello riceve la sua mail', async () => {
    await handleCheckoutCompleted(sessione);
    await eseguiIlLavoroRimandato();

    expect(emailSpedite).toContain('seller-1@negozio.test');
    expect(emailSpedite).toContain('seller-2@negozio.test');
  });

  it('un invio che lancia sul primo ordine non lascia muto il secondo negozio', async () => {
    // Il guasto: la conferma al cliente del primo ordine non parte.
    indirizziGuasti.add('cliente@test.it');

    await handleCheckoutCompleted(sessione);
    await eseguiIlLavoroRimandato();

    expect(
      emailSpedite,
      'il secondo negoziante non e stato avvisato: ha un ordine pagato e non lo sa',
    ).toContain('seller-2@negozio.test');
    expect(
      emailSpedite,
      'il primo negoziante e rimasto senza mail per colpa di un invio diverso dal suo',
    ).toContain('seller-1@negozio.test');
  });

  it('un negozio irraggiungibile non ferma la posta degli altri', async () => {
    // Il guasto: l'indirizzo del PRIMO negozio rifiuta.
    indirizziGuasti.add('seller-1@negozio.test');

    await handleCheckoutCompleted(sessione);
    await eseguiIlLavoroRimandato();

    expect(
      emailSpedite,
      'il secondo negoziante paga il guasto del primo: nessuno gli dice che ha un ordine',
    ).toContain('seller-2@negozio.test');
    expect(emailSpedite.filter((e) => e === 'cliente@test.it')).toHaveLength(2);
  });
});

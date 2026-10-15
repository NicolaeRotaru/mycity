import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 15/10/2026 (R24) — LE EMAIL D'ORDINE USCIVANO COME PUBBLICITA'.
 *
 * `sendEmail` trattava come commerciale ogni email per cui chi chiama non
 * dichiarava il tipo, e nessuna delle email legate ai soldi lo dichiarava:
 * conferma d'ordine, «nuovo ordine» al negozio, rimborsi, buono regalo. Uscivano
 * tutte con «Annulla l'iscrizione con un clic» in fondo e con le due
 * intestazioni che accendono il pulsante «Annulla iscrizione» di Gmail.
 *
 * Maria ordina il pane da Pane Quotidiano, riceve la conferma, preme
 * «Annulla iscrizione» pensando di spegnere gli avvisi dell'ordine: spegne le
 * promozioni, e gli avvisi arrivano lo stesso. Infastidita ci segna come spam,
 * e da li' finisce nello spam la posta di tutti.
 *
 * La prova di prima chiamava `sendEmail` col tipo gia' scritto: misurava il
 * meccanismo, non chi lo usa — ed era verde mentre il difetto era vivo. Questa
 * esegue le funzioni VERE che spediscono (il webhook della carta, il buono
 * regalo, il giro dei carrelli dimenticati) e guarda il pacchetto che arriva al
 * servizio di posta. E' finto solo Resend: `lib/email/client.ts` e i modelli
 * delle email sono quelli veri.
 */

type Pacchetto = { to?: string | string[]; subject?: string; html?: string; headers?: Record<string, string> };

/** Il pacchetto vero, come lo riceve il servizio di posta. */
const alServizioDiPosta: Pacchetto[] = [];

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (p: Pacchetto) => {
        alServizioDiPosta.push(p);
        return { data: { id: 'msg-1' }, error: null };
      },
    };
  },
}));

/** Il lavoro che il webhook rimanda a dopo la risposta (`after`). */
const rimandati: Array<() => Promise<void>> = [];
vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => { rimandati.push(fn); },
  NextResponse: { json: (b: unknown, i?: ResponseInit) => new Response(JSON.stringify(b), i) },
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/analytics/server', () => ({
  analyticsConsentita: async () => false,
  contaAcquisto: async () => {},
}));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ paymentIntents: { retrieve: async () => ({ latest_charge: 'ch_1' }) } }),
  computeOrderSplit: () => ({ applicationFeeCents: 250, sellerPayoutCents: 2250 }),
}));
vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));

const PENDING = {
  id: 'pc_1',
  buyer_id: 'cliente-1',
  status: 'PENDING',
  total_cents: 2500,
  stripe_session_id: 'cs_1',
  coupon_code: null,
  pickup_in_store: false,
  delivery: { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: null },
  groups: [{
    sellerId: 'negozio-1', storeName: 'Pane Quotidiano', totalCents: 2500, shippingCents: 0, deliveryFeeCents: 0,
    riderFeeCents: 300, couponPortionCents: 0, pickupPortionCents: 0,
    items: [{ productId: 'p1', name: 'Pane di Altamura', quantity: 2, unitAmountCents: 1250 }],
  }],
};

/** Un database finto che risponde quanto basta a ciascuna delle tre strade. */
function risposta(tabella: string, operazione: string): unknown {
  if (tabella === 'pending_checkouts' && operazione === 'select') return { data: PENDING, error: null };
  if (tabella === 'orders' && operazione === 'insert') return { data: { id: 'ordine-1' }, error: null };
  if (tabella === 'profiles' && operazione === 'select') {
    return { data: [{ id: 'cliente-1', full_name: 'Maria Rossi', email_marketing: true }], error: null };
  }
  return { data: [], error: null };
}

function catena(tabella: string) {
  let operazione = 'select';
  const b: Record<string, unknown> = {};
  for (const m of ['eq', 'in', 'is', 'lt', 'lte', 'gte', 'order', 'limit', 'not', 'or']) b[m] = () => b;
  for (const m of ['select', 'insert', 'update', 'delete', 'upsert']) {
    b[m] = () => { if (m !== 'select' || operazione === 'select') operazione = m; return b; };
  }
  const esito = () => risposta(tabella, operazione);
  b.single = () => Promise.resolve(esito());
  b.maybeSingle = () => Promise.resolve(esito());
  b.then = (r: (v: unknown) => unknown) => Promise.resolve(esito()).then(r);
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => catena(t),
    rpc: async (nome: string) => (nome === 'list_abandoned_carts_to_recover'
      ? { data: [{ user_id: 'cliente-1', email: 'maria@example.it', full_name: 'Maria Rossi', cart_data: [{ quantity: 2, name: 'Pane di Altamura' }], cart_total: 25 }], error: null }
      : { data: null, error: null }),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@example.it` } } }) } },
  }),
}));

beforeEach(() => {
  alServizioDiPosta.length = 0;
  rimandati.length = 0;
  vi.resetModules();
  vi.stubEnv('RESEND_API_KEY', 're_prova');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
  vi.stubEnv('UNSUBSCRIBE_SECRET', 'un-segreto-lungo-abbastanza');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function senzaIlTastoPerSmettere(p: Pacchetto | undefined, cosa: string) {
  expect(p, `${cosa}: non e nemmeno partita`).toBeTruthy();
  const html = String(p?.html ?? '');
  expect(html, `${cosa}: chi preme «Annulla l'iscrizione» spegne le promozioni credendo di spegnere gli avvisi`).not.toContain('/api/unsubscribe');
  expect(html).not.toContain("Annulla l'iscrizione");
  const intestazioni = p?.headers ?? {};
  expect(intestazioni['List-Unsubscribe'], `${cosa}: Gmail accende il pulsante «Annulla iscrizione»`).toBeUndefined();
  expect(intestazioni['List-Unsubscribe-Post']).toBeUndefined();
}

describe('le email d ordine pagato con la carta', () => {
  it('la conferma al cliente e il «nuovo ordine» al negozio escono senza il tasto per smettere', async () => {
    const { handleCheckoutCompleted } = await import('@/lib/stripe/webhook/ordini');
    await handleCheckoutCompleted({
      id: 'cs_1', payment_status: 'paid', client_reference_id: 'pc_1', amount_total: 2500,
      payment_intent: 'pi_1', customer_details: { email: 'maria@example.it', name: 'Maria Rossi' }, metadata: {},
    } as never);
    for (const lavoro of rimandati) await lavoro();

    const alCliente = alServizioDiPosta.find((p) => p.to === 'maria@example.it');
    const alNegozio = alServizioDiPosta.find((p) => p.to === 'negozio-1@example.it');
    expect(String(alCliente?.subject ?? ''), 'non e la conferma d ordine').toMatch(/ordine/i);
    senzaIlTastoPerSmettere(alCliente, 'la conferma d ordine al cliente');
    senzaIlTastoPerSmettere(alNegozio, 'l avviso di nuovo ordine al negozio');
  });
});

describe('le email del buono regalo', () => {
  it('a chi lo riceve e a chi lo compra escono senza il tasto per smettere', async () => {
    const { handleGiftCardPurchase } = await import('@/lib/stripe/webhook/giftcard');
    await handleGiftCardPurchase({
      id: 'cs_gc', payment_status: 'paid',
      metadata: { amount_cents: '3000', buyer_id: 'cliente-1', recipient_name: 'Anna', recipient_email: 'anna@example.it', message: 'Auguri' },
      customer_details: { email: 'maria@example.it' },
    } as never);

    senzaIlTastoPerSmettere(alServizioDiPosta.find((p) => p.to === 'anna@example.it'), 'il buono a chi lo riceve');
    senzaIlTastoPerSmettere(alServizioDiPosta.find((p) => p.to === 'maria@example.it'), 'la ricevuta del buono a chi lo compra');
  });
});

describe('le email commerciali il modo di smettere lo tengono', () => {
  it('il promemoria del carrello dimenticato esce col link e col pulsante di Gmail', async () => {
    const { GET } = await import('@/app/api/cron/abandoned-carts/route');
    await (GET as unknown as (r: Request) => Promise<Response>)(new Request('http://localhost/api/cron/abandoned-carts'));

    const p = alServizioDiPosta.find((x) => x.to === 'maria@example.it');
    expect(p, 'il promemoria non e partito').toBeTruthy();
    expect(String(p?.html ?? ''), "una email commerciale senza il modo di smettere non si puo' spedire").toContain('/api/unsubscribe');
    expect(p?.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/mycity\.example\/api\/unsubscribe/);
    expect(p?.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});

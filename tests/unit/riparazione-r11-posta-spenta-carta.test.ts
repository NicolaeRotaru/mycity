import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Sulla strada della carta, con la posta spenta (chiave o mittente mancanti sul sito vero),
 * l'ordine pagato nasceva e nessuno lo sapeva: `sendEmail` risponde «skipped» e l'avviso della
 * posta non partita saltava apposta quei casi. La strada dei contanti suona già la campanella
 * «la posta del sito è spenta». Qui passa il webhook vero della carta (`handleCheckoutCompleted`),
 * con la vera `sendEmail` e solo Resend finto: con la posta spenta parte la campanella, una per
 * ordine; con la posta accesa nessun avviso falso; in anteprima nessuna campanella.
 */

/** Le righe vere che `notifyAdmins` scrive in `notifications`: un id già scritto risponde 23505, come il database. */
const campanelle = vi.hoisted(() => [] as Array<{ id?: string; user_id: string; title: string; body: string }>);
const dopoLaRisposta = vi.hoisted(() => [] as Array<() => Promise<void>>);
const alServizioDiPosta = vi.hoisted(() => [] as Array<{ to?: unknown }>);

vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => { dopoLaRisposta.push(fn); },
  NextResponse: { json: (b: unknown, i?: ResponseInit) => new Response(JSON.stringify(b), i) },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (p: { to?: unknown }) => {
        alServizioDiPosta.push(p);
        return { data: { id: 'msg-1' }, error: null };
      },
    };
  },
}));
vi.mock('@/lib/analytics/server', () => ({ analyticsConsentita: async () => false, contaAcquisto: async () => {} }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ paymentIntents: { retrieve: async () => ({ latest_charge: 'ch_1' }) } }),
  computeOrderSplit: () => ({ applicationFeeCents: 100, sellerPayoutCents: 900 }),
}));

const PENDING = () => ({
  id: 'pc_1', buyer_id: 'buyer-1', status: 'PENDING', total_cents: 1800, stripe_session_id: 'cs_1', coupon_code: null,
  pickup_in_store: false,
  delivery: { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: null },
  groups: [{
    sellerId: 'pane-quotidiano', storeName: 'Pane Quotidiano', totalCents: 1800, shippingCents: 0, deliveryFeeCents: 300,
    riderFeeCents: 300, couponPortionCents: 0, pickupPortionCents: 0,
    items: [{ productId: 'p1', quantity: 1, unitAmountCents: 1500 }],
  }],
});

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => tabella === 'profiles' ? ({
      select: () => ({
        eq: (colonna: string) => ({
          maybeSingle: async () => ({ data: {}, error: null }),
          then: (r: (v: unknown) => unknown) => r({ data: colonna === 'role' ? [{ id: 'admin-1' }] : [], error: null }),
        }),
      }),
    }) : tabella === 'notifications' ? ({
      insert: (righe: Array<{ id?: string; user_id: string; title: string; body: string }> | { id?: string; user_id: string; title: string; body: string }) => {
        const elenco = Array.isArray(righe) ? righe : [righe];
        const doppia = elenco.some((r) => r.id && campanelle.some((c) => c.id === r.id));
        if (!doppia) campanelle.push(...elenco);
        const esito = { error: doppia ? { code: '23505', message: 'duplicate key' } : null };
        return { select: () => ({ single: async () => ({ data: null, ...esito }) }), then: (r: (v: unknown) => unknown) => r(esito) };
      },
    }) : ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          single: async () => ({ data: PENDING(), error: null }),
          maybeSingle: async () => ({ data: PENDING(), error: null }),
          then: undefined,
        }),
      }),
      insert: () => ({
        select: () => ({ single: async () => ({ data: { id: 'ordine-carta-1' }, error: null }) }),
        then: (r: (v: { error: null }) => unknown) => r({ error: null }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@negozio.test` } } }) } },
  }),
}));

const sessione = {
  id: 'cs_1', payment_status: 'paid', client_reference_id: 'pc_1', amount_total: 1800, payment_intent: 'pi_1',
  customer_details: { email: 'cliente@test.it', name: 'Maria Rossi' }, metadata: {},
} as never;

const dellaPostaSpenta = () => campanelle.filter((c) => c.user_id === 'admin-1' && /posta/i.test(c.title) && /spenta/i.test(c.title));

beforeEach(() => {
  campanelle.length = 0;
  dopoLaRisposta.length = 0;
  alServizioDiPosta.length = 0;
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T10:00:00.000Z'));
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
  vi.stubEnv('UNSUBSCRIBE_SECRET', 'un-segreto-lungo-abbastanza');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function paga() {
  const { handleCheckoutCompleted } = await import('@/lib/stripe/webhook/ordini');
  await handleCheckoutCompleted(sessione);
  for (const lavoro of dopoLaRisposta) await lavoro();
}

describe('sulla strada della carta la posta spenta avvisa gli amministratori', () => {
  it('senza RESEND_API_KEY sul sito vero: una campanella per l ordine pagato', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('RESEND_FROM', 'ordini@mycity.example');
    await paga();
    expect(alServizioDiPosta, 'senza chiave non deve partire niente').toHaveLength(0);
    const viste = dellaPostaSpenta();
    // Conferma al cliente e «Nuovo ordine» al negozio chiedono la stessa campanella (chiave
    // `posta-spenta:<ordine>`, la stessa della strada dei contanti): ne resta una per ordine.
    expect(viste, 'l ordine pagato con la carta nasceva senza email e nessuno lo sapeva').toHaveLength(1);
    expect(viste[0].body).toContain('RESEND_API_KEY');
    expect(viste[0].body).toContain('#ordine-c');
    expect(viste[0].body).toContain('Avvisa tu il negozio');
  });

  it('senza RESEND_FROM sul sito vero: lo stesso', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', 're_prova');
    vi.stubEnv('RESEND_FROM', '');
    await paga();
    expect(alServizioDiPosta).toHaveLength(0);
    expect(dellaPostaSpenta()).toHaveLength(1);
    expect(dellaPostaSpenta()[0].body).toContain('RESEND_FROM');
  });

  it('con la posta accesa: nessun avviso falso', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', 're_prova');
    vi.stubEnv('RESEND_FROM', 'ordini@mycity.example');
    await paga();
    expect(alServizioDiPosta.length, 'con la posta accesa le email devono partire').toBeGreaterThan(0);
    expect(dellaPostaSpenta()).toHaveLength(0);
    expect(campanelle.filter((c) => /email/i.test(c.title))).toHaveLength(0);
  });

  it('in anteprima, dove la posta può mancare apposta: nessuna campanella', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('RESEND_API_KEY', '');
    await paga();
    expect(dellaPostaSpenta()).toHaveLength(0);
  });
});

/**
 * Collaudo — il rimborso (lib/stripe/webhook/rimborsi.ts) e il buono regalo (giftcard.ts) passano
 * l'esito di `sendEmail` direttamente ad `avvisaSeLaPostaNonParte`, senza `provaAMandare`: per loro la
 * campanella della posta spenta nasce solo qui. La cassa con la carta la suona anche da comune.ts
 * (R03-003), quindi i casi sopra restano verdi anche senza questa riparazione; questi no.
 */
describe('anche rimborso e buono regalo, con la posta spenta, avvisano gli amministratori', () => {
  async function avvisa(cosa: string, dati: Record<string, unknown>) {
    const { sendEmail } = await import('@/lib/email/client');
    const { avvisaSeLaPostaNonParte } = await import('@/lib/stripe/webhook/posta-non-partita');
    const esito = await sendEmail({ to: 'cliente@test.it', subject: 'Prova', html: '<p>prova</p>', text: 'prova' });
    await avvisaSeLaPostaNonParte(cosa, dati, esito);
  }

  it('email di rimborso senza RESEND_API_KEY sul sito vero: una campanella per l ordine', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('RESEND_FROM', 'ordini@mycity.example');
    await avvisa('email di rimborso al cliente', { orderId: 'ordine-rimborsato-1' });
    expect(alServizioDiPosta).toHaveLength(0);
    expect(dellaPostaSpenta(), 'il rimborso con la posta spenta non avvisava nessuno').toHaveLength(1);
    expect(dellaPostaSpenta()[0].body).toContain('RESEND_API_KEY');
    expect(dellaPostaSpenta()[0].body).toContain('#ordine-r');
  });

  it('buono regalo senza RESEND_FROM sul sito vero: una campanella per la sessione, anche ripetuta', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', 're_prova');
    vi.stubEnv('RESEND_FROM', '');
    await avvisa('email del buono regalo al destinatario', { sessionId: 'cs_buono_1' });
    await avvisa('email del buono regalo al destinatario', { sessionId: 'cs_buono_1' });
    expect(dellaPostaSpenta()).toHaveLength(1);
    expect(dellaPostaSpenta()[0].body).toContain('RESEND_FROM');
  });

  it('in anteprima il buono regalo senza posta non suona', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('RESEND_API_KEY', '');
    await avvisa('email del buono regalo al destinatario', { sessionId: 'cs_buono_2' });
    expect(dellaPostaSpenta()).toHaveLength(0);
  });
});

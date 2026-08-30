import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 27/8/2026 (R159) — L'ACQUISTO NON ARRIVAVA QUASI MAI A POSTHOG.
 *
 * `order_placed` parte solo dal server (nel browser è spento apposta: chi
 * chiude la scheda dopo aver pagato sparirebbe dai conti). E il server lo manda
 * solo a chi ha detto sì all'analitica — giusto. Ma quel sì lo cercava per
 * `user_id`, e chi accetta il banner PRIMA di registrarsi — il percorso
 * normale: si arriva sul sito, si accettano i cookie, poi ci si iscrive per
 * comprare — finisce nel registro con `anon_id` e `user_id` a NULL. Il banner
 * non ricompare per sei mesi e nessun codice collegava mai i due.
 *
 * Quindi: ordine nel database, niente acquisto in PostHog. Non «qualche
 * volta»: quasi sempre. Ogni tasso di conversione e ogni ritorno di campagna
 * poggiava su un fatturato che non esiste, e il giorno in cui parte spesa
 * pubblicitaria vera il budget si deciderebbe su quel numero.
 *
 * Questa prova percorre la strada intera: consenso dato da anonimo su questo
 * browser → ordine in contanti → l'acquisto deve partire.
 */

/** Il registro dei consensi, come lo vedrebbe il database. */
type RigaConsenso = {
  user_id: string | null;
  anon_id: string | null;
  categoria: string;
  valore: boolean;
  created_at: string;
};
const consensi: RigaConsenso[] = [];
/** Le chiamate uscite verso il raccoglitore. */
const inviatoAPostHog: Array<Record<string, unknown>> = [];
const inseriti: Array<Record<string, unknown>> = [];

function risolvibile(valore: unknown) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    in: () => b,
    is: () => b,
    insert: () => b,
    update: () => b,
    delete: () => b,
    order: () => b,
    limit: () => b,
    single: () => Promise.resolve(valore),
    maybeSingle: () => Promise.resolve(valore),
    then: (res: (v: unknown) => unknown) => res(valore),
  };
  return b;
}

/**
 * Il registro dei consensi con i filtri veri: `analyticsConsentita` legge per
 * persona e categoria, la ricucitura scrive per identificativo anonimo.
 */
function tabellaConsensi() {
  return {
    select: () => {
      const filtri: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        eq: (col: string, v: unknown) => { filtri[col] = v; return b; },
        order: () => b,
        limit: () => b,
        maybeSingle: () => {
          const trovate = consensi
            .filter((r) => (filtri.user_id === undefined || r.user_id === filtri.user_id))
            .filter((r) => (filtri.categoria === undefined || r.categoria === filtri.categoria))
            .sort((a, b2) => (a.created_at < b2.created_at ? 1 : -1));
          return Promise.resolve({ data: trovate[0] ? { valore: trovate[0].valore } : null, error: null });
        },
      };
      return b;
    },
    update: (valori: Record<string, unknown>) => {
      const condizioni: { nulli: string[]; dentro: Record<string, unknown[]> } = { nulli: [], dentro: {} };
      const applica = () => {
        for (const r of consensi) {
          const soloNulli = condizioni.nulli.every((c) => (r as unknown as Record<string, unknown>)[c] === null);
          const dentro = Object.entries(condizioni.dentro).every(([c, vals]) =>
            vals.includes((r as unknown as Record<string, unknown>)[c]));
          if (soloNulli && dentro) Object.assign(r, valori);
        }
        return { error: null };
      };
      const b: Record<string, unknown> = {
        is: (col: string) => { condizioni.nulli.push(col); return b; },
        in: (col: string, vals: unknown[]) => { condizioni.dentro[col] = vals; return b; },
        eq: (col: string, v: unknown) => { condizioni.dentro[col] = [v]; return b; },
        then: (res: (x: unknown) => unknown) => res(applica()),
      };
      return b;
    },
  };
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (
    _opts: unknown,
    h: (ctx: { user: { id: string; email: string; email_confirmed_at: string }; profile: unknown; req: unknown }) => unknown,
  ) => (req: unknown) => h({
    user: { id: 'cliente-1', email: 'cliente@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
    profile: { role: 'buyer', is_approved: true },
    req,
  }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'nessuno' })) }));
vi.mock('@/lib/shipping', () => ({
  shippingCentsFor: vi.fn(() => 500),
  compensoRiderCents: vi.fn(() => 250),
}));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
vi.mock('@/lib/store-hours', () => ({ isStoreClosedForOrder: vi.fn(() => false) }));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
  newOrderSellerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
}));
vi.mock('@/lib/stripe/client', () => ({
  computeOrderSplit: vi.fn(() => ({ applicationFeeCents: 100, sellerPayoutCents: 900 })),
}));
// NOTA: `@/lib/analytics/server` NON e' finto. E' il pezzo che deve funzionare.

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: '11111111-1111-1111-1111-111111111111', seller_id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Pane', price: 5, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', store_name: 'Forno', store_lat: 45.05, store_lng: 9.69, store_hours: null },
  ];

  const from = (table: string): Record<string, unknown> => {
    if (table === 'consent_log') return tabellaConsensi() as unknown as Record<string, unknown>;
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'seller_public_profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'orders') {
      return {
        insert: (valori: Record<string, unknown>) => {
          inseriti.push(valori);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: `ord-${inseriti.length}` }, error: null }) }) };
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
        select: () => risolvibile({ data: [], error: null }),
      };
    }
    if (table === 'order_items') return { insert: () => Promise.resolve({ error: null }) };
    if (table === 'notifications') return { insert: () => Promise.resolve({ error: null }) };
    return risolvibile({ data: [], error: null });
  };

  const rpc = (name: string) => {
    if (name === 'wallet_debit') return Promise.resolve({ data: 0, error: null });
    return Promise.resolve({ data: null, error: null });
  };

  return {
    getAdminSupabase: () => ({
      from,
      rpc,
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@test.it` } } }) } },
    }),
    getServerSupabase: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'cliente-1', email: 'cliente@test.it' } } }) },
      from,
    }),
  };
});

function richiesta(cookie: string | null): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({
      groups: [
        { sellerId: 'aaaaaaaa-0000-0000-0000-000000000001', items: [{ productId: '11111111-1111-1111-1111-111111111111', quantity: 1 }] },
      ],
      delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

async function ordina(cookie: string | null) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(richiesta(cookie));
  // `dopoLaRisposta` fuori da una richiesta vera parte e non si aspetta: qui si
  // lascia un attimo alla misura per uscire.
  await new Promise((r) => setTimeout(r, 30));
  return res;
}

beforeEach(() => {
  consensi.length = 0;
  inseriti.length = 0;
  inviatoAPostHog.length = 0;
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_finta');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('posthog')) {
      inviatoAPostHog.push(JSON.parse(String(init?.body ?? '{}')));
    }
    return new Response('{"status":1}', { status: 200 });
  }));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('l acquisto di chi aveva accettato i cookie da anonimo', () => {
  it('arriva al raccoglitore, perche il si di questo browser diventa suo', async () => {
    // Come succede davvero: si accettano i cookie prima di avere un account.
    consensi.push({
      user_id: null, anon_id: 'vid-1', categoria: 'analytics', valore: true,
      created_at: '2026-08-01T10:00:00Z',
    });

    const res = await ordina('mc_vid=vid-1; altrocookie=x');
    expect(res.status).toBe(200);
    expect(inseriti.length, 'l ordine non e stato creato').toBe(1);
    expect(
      inviatoAPostHog.length,
      'l acquisto non e arrivato al raccoglitore: il si dato da anonimo si e perso',
    ).toBe(1);
    expect(inviatoAPostHog[0].event).toBe('order_placed');
    // E la riga anonima adesso ha un proprietario: la prossima volta si trova
    // subito, senza dover ripassare dai cookie.
    expect(consensi[0].user_id).toBe('cliente-1');
  });

  it('e porta con se il gruppo dell esperimento letto dal cookie (R165)', async () => {
    consensi.push({
      user_id: null, anon_id: 'vid-1', categoria: 'analytics', valore: true,
      created_at: '2026-08-01T10:00:00Z',
    });

    await ordina('mc_vid=vid-1; mc_exp_home_hero=b');
    expect(inviatoAPostHog.length).toBe(1);
    const props = (inviatoAPostHog[0] as { properties: Record<string, unknown> }).properties;
    expect(
      props.home_hero_variant,
      'la variante del test A/B non arriva fino all acquisto: l esperimento resta non misurabile',
    ).toBe('b');
  });

  it('chi ha detto NO da anonimo resta fuori: la ricucitura non ribalta la scelta', async () => {
    consensi.push({
      user_id: null, anon_id: 'vid-2', categoria: 'analytics', valore: false,
      created_at: '2026-08-01T10:00:00Z',
    });

    await ordina('mc_vid=vid-2');
    expect(
      inviatoAPostHog.length,
      'e partito comunque: il no di chi lo ha detto da anonimo non viene rispettato',
    ).toBe(0);
  });

  it('senza nessun consenso in giro non parte niente', async () => {
    await ordina('mc_vid=vid-3');
    expect(inviatoAPostHog.length).toBe(0);
  });
});

describe('la ricucitura dei consensi anonimi, da sola', () => {
  it('legge i due identificativi che questo progetto scrive nei cookie', async () => {
    const { identificativiAnonimi } = await import('@/lib/analytics/riconcilia-consenso');
    expect(identificativiAnonimi('mc_vid=abc; mc_cid=def')).toEqual(['abc', 'def']);
    expect(identificativiAnonimi('altro=1; mc_cid=def')).toEqual(['def']);
    // «mc_vidale» non e' «mc_vid»: un prefisso che combacia per caso
    // attaccherebbe alla persona i consensi di qualcun altro.
    expect(identificativiAnonimi('xmc_vid=abc')).toEqual([]);
    expect(identificativiAnonimi(null)).toEqual([]);
  });

  it('non tocca le righe che hanno gia un proprietario', async () => {
    const { collegaConsensiAnonimi } = await import('@/lib/analytics/riconcilia-consenso');
    consensi.push({ user_id: 'un-altro', anon_id: 'vid-9', categoria: 'analytics', valore: true, created_at: '2026-08-01T10:00:00Z' });
    await collegaConsensiAnonimi({ from: (t: string) => (t === 'consent_log' ? tabellaConsensi() : risolvibile({ data: null, error: null })) }, 'cliente-1', ['vid-9']);
    expect(consensi[0].user_id, 'ha rubato il consenso di un altro account').toBe('un-altro');
  });
});

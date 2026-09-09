import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 8/9/2026 — LA SECONDA CASSA USCIVA DALLA PORTA DI SERVIZIO.
 *
 * ── Cosa succedeva a una persona vera ───────────────────────────────────────
 * Maria mette una torta nel carrello e preme «Paga con carta»: si apre la
 * pagina A di Stripe. Ci ripensa, torna indietro, sposta la consegna da «oggi
 * pomeriggio» a «domani mattina» e ripaga: nasce la pagina B, e la A doveva
 * morire — ma Stripe in quel momento non risponde e la A resta viva.
 * Maria rimette la fascia di prima e ripreme: adesso il carrello è identico a
 * quello della pagina B, quindi la cassa le restituisce la B invece di aprirne
 * una terza. Giusto — ma la A è ancora lì. Due pagine vive sulla stessa torta,
 * tutte e due pagabili, e la torta è una.
 *
 * ── Perché nessuno se n'era accorto ─────────────────────────────────────────
 * Il cancello che ferma tutto quando una pagina vecchia è rimasta pagabile
 * esiste, ma sta duecento righe più in basso, dentro la rivendicazione del
 * codice sconto. Il ramo che riusa la sessione esce PRIMA, con un `return` suo:
 * quel cancello non lo guardava mai. Due squadre, due punti del file, nessuna
 * delle due sbagliata da sola.
 *
 * ── Cosa difende questa prova ───────────────────────────────────────────────
 * Si esegue la rotta VERA, con una pulizia che dichiara una pagina vecchia
 * rimasta pagabile, e si pretende che dalla cassa non esca nessun indirizzo di
 * pagamento — né uno nuovo né quello già aperto. Se un domani il ramo del riuso
 * tornasse a uscire senza guardare il cancello, qui diventa rosso.
 */

const P1 = '11111111-1111-1111-1111-111111111111';
const S1 = 'aaaaaaaa-0000-0000-0000-000000000001';

/** Cosa risponde la pulizia dei tentativi abbandonati, prova per prova. */
const pulizia: { liberati: string[]; ancoraPagabili: string[] } = { liberati: [], ancoraPagabili: [] };
/** Le sessioni di pagamento NUOVE davvero create. */
const sessioniCreate: string[] = [];
/** Il tentativo già aperto sullo stesso identico carrello. */
const tentativoAperto = {
  presente: true,
  id: 'pc_stesso_carrello',
  stripe_session_id: 'cs_stesso_carrello',
  delivery: { full_name: 'Maria Rossi', phone: '3331234567', notes: null } as Record<string, unknown>,
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (
    _opts: unknown,
    h: (ctx: { user: { id: string; email: string; email_confirmed_at: string }; profile: unknown; req: Request }) => unknown,
  ) => (req: Request) => h({
    user: { id: 'maria', email: 'maria@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
    profile: { role: 'buyer', is_approved: true },
    req,
  }),
  assertCanPurchase: vi.fn(() => null),
}));

// La pulizia è finta apposta: qui non si prova COME nasce `ancoraPagabili`
// (quello lo provano le prove di `riserve-abbandonate`), si prova che la rotta
// la guardi prima di restituire una cassa.
vi.mock('@/lib/ordini/riserve-abbandonate', () => ({
  liberaRiserveAbbandonate: vi.fn(async () => ({
    liberati: [...pulizia.liberati],
    ancoraPagabili: [...pulizia.ancoraPagabili],
  })),
}));

vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  RiservaTroppoCorta: class RiservaTroppoCorta extends Error {},
  createMultiSellerCheckoutSession: vi.fn(async () => {
    const id = `cs_nuova_${sessioniCreate.length + 1}`;
    sessioniCreate.push(id);
    return { id, url: `https://stripe.test/${id}` };
  }),
  getStripe: () => ({
    checkout: {
      sessions: {
        // La pagina dello stesso carrello è viva e riusabile.
        retrieve: async (id: string) => ({ id, status: 'open', url: `https://stripe.test/${id}` }),
      },
    },
  }),
}));
vi.mock('@/lib/coupons', () => ({
  validateCoupon: vi.fn(async () => ({ ok: true, discount: 0, freeShipping: false, coupon: { code: 'X' } })),
}));
vi.mock('@/lib/shipping', () => ({ shippingCentsFor: vi.fn(() => 490), compensoRiderCents: vi.fn(() => 300) }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));
vi.mock('@/lib/store-hours', () => ({
  negozioPuoServire: vi.fn(() => true),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso in questo momento.`),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: P1, seller_id: S1, name: 'Torta', price: 20, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [{ id: S1, store_name: 'Pane Quotidiano', store_lat: 45.05, store_lng: 9.69, store_hours: null }];

  const letture = (tavola: string) => ({
    select: () => ({
      in: () => Promise.resolve({
        data: tavola === 'products' ? prodotti : tavola === 'product_variants' ? [] : venditori,
        error: null,
      }),
      eq: () => Promise.resolve({ data: [], error: null }),
    }),
  });

  const tabellaIntenti = () => ({
    select: () => {
      const b: Record<string, unknown> = {
        eq: () => b, gt: () => b, filter: () => b, order: () => b, limit: () => b,
        maybeSingle: () => Promise.resolve({
          data: tentativoAperto.presente
            ? {
                id: tentativoAperto.id,
                stripe_session_id: tentativoAperto.stripe_session_id,
                delivery: tentativoAperto.delivery,
              }
            : null,
          error: null,
        }),
      };
      return b;
    },
    insert: () => ({
      select: () => ({
        single: () => Promise.resolve({
          data: { id: 'pc_nuovo', expires_at: new Date(Date.now() + 2 * 3600_000).toISOString() },
          error: null,
        }),
      }),
    }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  });

  const adminFrom = (tavola: string): Record<string, unknown> => {
    if (tavola === 'pending_checkouts') return tabellaIntenti() as unknown as Record<string, unknown>;
    if (tavola === 'consent_log') return { update: () => ({ is: () => ({ in: () => Promise.resolve({ error: null }) }) }) };
    if (tavola === 'user_addresses') return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    return { insert: () => Promise.resolve({ error: null }) };
  };

  const rpc = (nome: string) => Promise.resolve({ data: nome === 'claim_coupon' ? true : null, error: null });

  return {
    getServerSupabase: async () => ({ from: letture, rpc }),
    getAdminSupabase: () => ({ from: adminFrom, rpc }),
  };
});

const carrello = {
  groups: [{ sellerId: S1, items: [{ productId: P1, quantity: 1 }], shippingCents: 0 }],
  delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
  pickupInStore: false,
};

async function paga() {
  const { POST } = await import('@/app/api/stripe/checkout/route');
  const req = new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(carrello),
  });
  const res = await (POST as unknown as (r: never) => Promise<Response>)(req as never);
  return { stato: res.status, corpo: (await res.json()) as Record<string, never> };
}

beforeEach(() => {
  pulizia.liberati = [];
  pulizia.ancoraPagabili = [];
  sessioniCreate.length = 0;
  tentativoAperto.presente = true;
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.test');
});

describe('la rotta con la carta, quando un pagamento vecchio è rimasto pagabile', () => {
  it('NON restituisce la cassa già aperta: risponde 409 e non esce nessun indirizzo di pagamento', async () => {
    // La pulizia non è riuscita a chiudere la pagina di un tentativo di prima.
    pulizia.ancoraPagabili = ['cs_pagina_A_rimasta_viva'];

    const risposta = await paga();

    expect(
      risposta.stato,
      'la cassa ha risposto come se fosse tutto a posto, con una pagina vecchia ancora pagabile',
    ).toBe(409);
    expect(
      JSON.stringify(risposta.corpo),
      'dalla cassa è uscito un indirizzo di pagamento: sono due pagine vive sugli stessi articoli',
    ).not.toContain('https://stripe.test/');
    expect(
      sessioniCreate,
      'è stata anche aperta una pagina di pagamento nuova',
    ).toEqual([]);
  });

  it('il messaggio dice cosa fare, non cosa è successo dentro', async () => {
    pulizia.ancoraPagabili = ['cs_pagina_A_rimasta_viva'];
    const { corpo } = await paga();
    const messaggio = (corpo as unknown as { error?: { message?: string } }).error?.message ?? '';
    expect(messaggio.length, 'chi compra non legge nessuna spiegazione').toBeGreaterThan(20);
    expect(messaggio.toLowerCase(), 'il messaggio non dice di riprovare').toContain('riprova');
  });

  it('ma se non è rimasto niente di pagabile, il riuso funziona come prima', async () => {
    // Il controllo: il cancello non deve bloccare chi non ha niente in sospeso.
    pulizia.ancoraPagabili = [];

    const risposta = await paga();

    expect(risposta.stato, 'il cancello blocca anche chi non ha nessun pagamento vecchio aperto').toBe(200);
    expect(
      (risposta.corpo as unknown as { data: { url: string } }).data.url,
      'non è stata riusata la pagina già aperta dello stesso carrello',
    ).toBe('https://stripe.test/cs_stesso_carrello');
    expect(sessioniCreate, 'è stata aperta una seconda pagina di pagamento').toEqual([]);
  });
});

describe('la regola, da sola', () => {
  it('una sola pagina vecchia rimasta pagabile ferma anche il riuso', async () => {
    const { riusoDellaCassaAperta } = await import('@/lib/ordini/riuso-della-cassa-aperta');
    const esito = riusoDellaCassaAperta(
      { liberati: ['pc_1'], ancoraPagabili: ['cs_vecchia'] },
      { id: 'cs_stesso', status: 'open', url: 'https://stripe.test/cs_stesso' },
    );
    expect(esito.esito, 'la cassa già aperta viene restituita accanto a una pagina vecchia viva').toBe('ferma_tutto');
    if (esito.esito !== 'ferma_tutto') return;
    expect(esito.sessioni).toEqual(['cs_vecchia']);
  });

  it('strada libera e pagina viva: si riusa quella, non se ne apre una seconda', async () => {
    const { riusoDellaCassaAperta } = await import('@/lib/ordini/riuso-della-cassa-aperta');
    expect(
      riusoDellaCassaAperta({ liberati: [], ancoraPagabili: [] }, { id: 'cs_a', status: 'open', url: 'https://s/a' }),
    ).toEqual({ esito: 'riusa', id: 'cs_a', url: 'https://s/a' });
  });

  it('strada libera ma niente da riusare (scaduta, illeggibile, senza indirizzo): si apre una nuova', async () => {
    const { riusoDellaCassaAperta } = await import('@/lib/ordini/riuso-della-cassa-aperta');
    const libera = { liberati: [], ancoraPagabili: [] };
    expect(riusoDellaCassaAperta(libera, null).esito).toBe('apri_nuova');
    expect(riusoDellaCassaAperta(libera, { id: 'cs_a', status: 'expired', url: 'https://s/a' }).esito).toBe('apri_nuova');
    expect(riusoDellaCassaAperta(libera, { id: 'cs_a', status: 'open', url: '' }).esito).toBe('apri_nuova');
  });

  it('«non ho potuto rileggere la sessione» non è un via libera: il cancello vale lo stesso', async () => {
    const { riusoDellaCassaAperta } = await import('@/lib/ordini/riuso-della-cassa-aperta');
    expect(
      riusoDellaCassaAperta({ liberati: [], ancoraPagabili: ['cs_vecchia'] }, null).esito,
      'con Stripe muto e una pagina vecchia viva la rotta tira dritto',
    ).toBe('ferma_tutto');
  });
});

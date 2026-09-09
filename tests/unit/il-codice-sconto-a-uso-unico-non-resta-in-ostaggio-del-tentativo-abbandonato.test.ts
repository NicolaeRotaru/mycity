import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';
import {
  laStradaELibera,
  rivendicaIlCodiceSconto,
  type ClientRivendica,
} from '@/lib/ordini/rivendica-il-codice-sconto';

/**
 * 8/9/2026 — «CODICE ESAURITO», E A ESAURIRLO ERA STATO LUI UN MINUTO PRIMA.
 *
 * Maria ha `UNICO1`, che vale una volta sola. Preme «Paga con carta»: il codice
 * risulta usato, la merce viene messa da parte e si apre la pagina di Stripe.
 * Ci ripensa, torna indietro e sposta la consegna da oggi pomeriggio a domani
 * mattina. Ripreme «Paga»: il carrello è cambiato, quindi la pagina di prima
 * non si riusa, e la cassa risponde 400 «Coupon non valido: Codice esaurito».
 *
 * Il codice è in mano sua, l'ordine non esiste, e nessuno ha comprato niente.
 * La riparazione che glielo avrebbe restituito — `liberaRiserveAbbandonate` —
 * c'era già, ma girava 130 righe più in basso: la richiesta moriva prima di
 * arrivarci.
 *
 * Qui il difetto si RIESEGUE: due POST veri sulla rotta, con un database finto
 * che conta gli usi del codice come li conta Postgres (`claim_coupon` +1 se ne
 * restano, `release_coupon` -1 mai sotto zero) e che scala le scorte come
 * `reserve_stock`. Il secondo POST deve rispondere 200.
 */

const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';

/* ─── Lo stato del finto database, azzerato prima di ogni prova ──────────── */

type RigaIntento = {
  id: string;
  buyer_id: string;
  status: string;
  groups: Array<{ items: Array<{ productId: string; quantity: number; variantId: string | null }> }>;
  coupon_code: string | null;
  stripe_session_id: string | null;
  delivery: Record<string, unknown>;
  expires_at: string;
};

const db = {
  /** Il codice a uso unico, con il contatore vero. */
  coupon: { code: 'UNICO1', type: 'FIXED', value: 2, min_subtotal: 0, max_uses: 1, uses_count: 0, first_order_only: false, expires_at: null, active: true, description: null },
  scorte: 10,
  intenti: [] as RigaIntento[],
  sessioniChiuse: [] as string[],
  sessioniCreate: [] as string[],
  rpc: [] as string[],
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (ctx: { user: { id: string; email: string; email_confirmed_at: string }; profile: unknown; req: Request }) => unknown) =>
    (req: Request) =>
      h({
        user: { id: 'maria', email: 'maria@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
        profile: { role: 'buyer', is_approved: true },
        req,
      }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  RiservaTroppoCorta: class RiservaTroppoCorta extends Error {},
  createMultiSellerCheckoutSession: vi.fn(async () => {
    const id = `cs_${db.sessioniCreate.length + 1}`;
    db.sessioniCreate.push(id);
    return { id, url: `https://stripe.test/${id}` };
  }),
  getStripe: () => ({
    checkout: {
      sessions: {
        // La pagina vecchia è ancora aperta: è il caso di chi torna indietro.
        retrieve: async (id: string) => ({ id, status: 'open', url: `https://stripe.test/${id}` }),
        expire: async (id: string) => { db.sessioniChiuse.push(id); return { id, status: 'expired' }; },
      },
    },
  }),
}));
// `@/lib/coupons` NON è mockato apposta: la validazione vera deve leggere il
// contatore vero, perché è lei a rispondere «Codice esaurito».
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));
vi.mock('@/lib/store-hours', () => ({
  negozioPuoServire: vi.fn(() => true),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso.`),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = () => [
    { id: PRODOTTO, seller_id: NEGOZIO, name: 'Torta', price: 20, stock: db.scorte, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [{ id: NEGOZIO, store_name: 'Pane Quotidiano', store_lat: 45.05, store_lng: 9.69, store_hours: null }];

  /** Catena che risponde sempre lo stesso valore, comunque la si concateni. */
  const fisso = (valore: unknown) => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, in: () => b, gt: () => b, filter: () => b, order: () => b, limit: () => b,
      single: () => Promise.resolve(valore), maybeSingle: () => Promise.resolve(valore),
      then: (res: (v: unknown) => unknown) => Promise.resolve(valore).then(res),
    };
    return b;
  };

  /** La tabella dei tentativi: distingue le due letture dalla forma della catena. */
  const tabellaIntenti = () => ({
    select: () => {
      const filtri: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        eq: (col: string, v: unknown) => { filtri[col] = v; return b; },
        gt: () => b,
        filter: (col: string, _op: string, v: unknown) => { filtri[col] = v; return b; },
        order: () => b,
        limit: () => b,
        // Chi chiude con `maybeSingle` è il riuso della sessione: cerca lo
        // STESSO carrello (impronta uguale).
        maybeSingle: () => {
          const trovato = db.intenti.find(
            (r) =>
              r.buyer_id === filtri.buyer_id &&
              r.status === filtri.status &&
              r.delivery.impronta_carrello === filtri['delivery->>impronta_carrello'],
          );
          return Promise.resolve({ data: trovato ?? null, error: null });
        },
        // Chi si limita ad aspettare è la pulizia: vuole TUTTI i tentativi
        // aperti di questa persona.
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({
            data: db.intenti.filter((r) => r.buyer_id === filtri.buyer_id && r.status === filtri.status),
            error: null,
          }).then(res),
      };
      return b;
    },
    insert: (riga: Record<string, unknown>) => ({
      select: () => ({
        single: () => {
          const id = `pc_${db.intenti.length + 1}`;
          db.intenti.push({
            id,
            buyer_id: riga.buyer_id as string,
            status: (riga.status as string) ?? 'PENDING',
            groups: (riga.groups as RigaIntento['groups']) ?? [],
            coupon_code: (riga.coupon_code as string | null) ?? null,
            stripe_session_id: null,
            delivery: riga.delivery as Record<string, unknown>,
            expires_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
          });
          const nato = db.intenti[db.intenti.length - 1];
          return Promise.resolve({ data: { id: nato.id, expires_at: nato.expires_at }, error: null });
        },
      }),
    }),
    // La rivendicazione atomica PENDING → EXPIRED, e il salvataggio dell'id sessione.
    update: (valori: Record<string, unknown>) => {
      const filtri: Record<string, unknown> = {};
      const applica = () => {
        const riga = db.intenti.find(
          (r) => r.id === filtri.id && (filtri.status === undefined || r.status === filtri.status),
        );
        if (!riga) return { data: [], error: null };
        if (typeof valori.status === 'string') riga.status = valori.status;
        if (typeof valori.stripe_session_id === 'string') riga.stripe_session_id = valori.stripe_session_id;
        if (valori.delivery) riga.delivery = valori.delivery as Record<string, unknown>;
        return { data: [{ id: riga.id }], error: null };
      };
      const b: Record<string, unknown> = {
        eq: (col: string, v: unknown) => { filtri[col] = v; return b; },
        select: () => b,
        then: (res: (v: unknown) => unknown) => Promise.resolve(applica()).then(res),
      };
      return b;
    },
  });

  const letture = (tavola: string) => {
    if (tavola === 'products') return fisso({ data: prodotti(), error: null });
    if (tavola === 'seller_public_profiles') return fisso({ data: venditori, error: null });
    if (tavola === 'product_variants') return fisso({ data: [], error: null });
    // `validateCoupon` legge di qui: il contatore è quello vivo.
    if (tavola === 'coupons') return fisso({ data: { ...db.coupon }, error: null });
    return fisso({ data: [], error: null });
  };

  const adminFrom = (tavola: string): Record<string, unknown> => {
    if (tavola === 'pending_checkouts') return tabellaIntenti() as unknown as Record<string, unknown>;
    // Nessun ordine creato: i tentativi abbandonati si possono liberare.
    if (tavola === 'orders') return fisso({ data: [], error: null });
    if (tavola === 'consent_log') return { update: () => ({ is: () => ({ in: () => Promise.resolve({ error: null }) }) }) };
    return fisso({ data: [], error: null });
  };

  /** Le funzioni del database, con la stessa aritmetica delle migrazioni 108 e 116. */
  const rpc = (nome: string, args: Record<string, unknown>) => {
    db.rpc.push(nome);
    if (nome === 'claim_coupon') {
      const disponibile = db.coupon.max_uses === null || db.coupon.uses_count < db.coupon.max_uses;
      if (disponibile) db.coupon.uses_count += 1;
      return Promise.resolve({ data: disponibile, error: null });
    }
    if (nome === 'release_coupon') {
      db.coupon.uses_count = Math.max(0, db.coupon.uses_count - 1);
      return Promise.resolve({ data: db.coupon.uses_count, error: null });
    }
    if (nome === 'reserve_stock') {
      const quante = (args.p_items as Array<{ qty: number }>).reduce((s, i) => s + i.qty, 0);
      if (quante > db.scorte) return Promise.resolve({ data: null, error: { message: 'stock insufficiente' } });
      db.scorte -= quante;
      return Promise.resolve({ data: null, error: null });
    }
    if (nome === 'restore_stock') {
      db.scorte += (args.p_items as Array<{ qty: number }>).reduce((s, i) => s + i.qty, 0);
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };

  return {
    getServerSupabase: async () => ({ from: letture, rpc }),
    getAdminSupabase: () => ({ from: adminFrom, rpc }),
  };
});

/* ─── Le due richieste: stesso carrello, fascia diversa ───────────────────── */

const carrello = (fascia: string) => ({
  groups: [{ sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: 1 }], shippingCents: 0 }],
  delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
  couponCode: 'UNICO1',
  pickupInStore: false,
  deliverySlot: fascia,
});

async function paga(fascia: string) {
  const { POST } = await import('@/app/api/stripe/checkout/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(
    new Request('http://localhost/api/stripe/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(carrello(fascia)),
    }) as never,
  );
  return { stato: res.status, corpo: (await res.json()) as { ok: boolean; data?: { url: string }; error?: { message: string } } };
}

beforeEach(() => {
  db.coupon.uses_count = 0;
  db.scorte = 10;
  db.intenti.length = 0;
  db.sessioniChiuse.length = 0;
  db.sessioniCreate.length = 0;
  db.rpc.length = 0;
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.test');
});

describe('un codice a uso unico e il secondo tentativo dello stesso cliente', () => {
  it('IL CASO CHE ROMPEVA — cambio la fascia e la cassa si apre lo stesso', async () => {
    const primo = await paga(FASCE_DI_DOMANI[0]);
    expect(primo.stato, 'il primo tentativo non è nemmeno partito').toBe(200);
    expect(db.coupon.uses_count, 'il primo tentativo non ha consumato il codice').toBe(1);

    const secondo = await paga(FASCE_DI_DOMANI[1]);

    expect(
      secondo.stato,
      `il cliente ha il codice in mano e il sistema glielo dichiara esaurito: «${secondo.corpo.error?.message ?? ''}»`,
    ).toBe(200);
    expect(secondo.corpo.data?.url, 'nessuna seconda pagina di pagamento aperta').toBe('https://stripe.test/cs_2');
  });

  it('il conto degli usi torna: uno solo consumato, non due', async () => {
    await paga(FASCE_DI_DOMANI[0]);
    await paga(FASCE_DI_DOMANI[1]);

    expect(
      db.coupon.uses_count,
      'il codice risulta consumato più volte di quante cassa ne sono aperte: al prossimo cliente risulterà esaurito',
    ).toBe(1);
  });

  it('la merce del tentativo lasciato a metà torna in vendita, e la pagina vecchia si chiude', async () => {
    await paga(FASCE_DI_DOMANI[0]);
    expect(db.scorte).toBe(9);

    await paga(FASCE_DI_DOMANI[1]);

    expect(db.scorte, 'la torta risulta impegnata due volte: per gli altri clienti è finita').toBe(9);
    expect(db.sessioniChiuse, 'la pagina di pagamento vecchia è rimasta pagabile').toEqual(['cs_1']);
    expect(db.intenti.map((r) => r.status)).toEqual(['EXPIRED', 'PENDING']);
  });

  it('lo stesso identico carrello riprende la cassa già aperta, senza toccare il codice', async () => {
    const primo = await paga(FASCE_DI_DOMANI[0]);
    const bis = await paga(FASCE_DI_DOMANI[0]);

    expect(bis.stato).toBe(200);
    expect(bis.corpo.data?.url).toBe(primo.corpo.data?.url);
    expect(db.sessioniCreate.length, 'è stata aperta una seconda cassa sullo stesso carrello').toBe(1);
    expect(db.coupon.uses_count).toBe(1);
  });
});

/* ─── La regola, eseguita da sola ─────────────────────────────────────────── */

function fintoAdmin(claimRiesce: boolean) {
  const chiamate: string[] = [];
  const admin: ClientRivendica = {
    rpc: (nome: string) => { chiamate.push(nome); return Promise.resolve({ data: claimRiesce, error: null }); },
  };
  return { admin, chiamate };
}

const letturaCoupon = (uses: number) => ({
  from: () => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b,
      maybeSingle: () => Promise.resolve({
        data: { code: 'UNICO1', type: 'FIXED', value: 2, min_subtotal: 0, max_uses: 1, uses_count: uses, first_order_only: false, expires_at: null, active: true },
        error: null,
      }),
    };
    return b;
  },
});

describe('la rivendicazione del codice pretende la pulizia', () => {
  it('con il contatore già ripulito il codice si rivendica', async () => {
    const { admin, chiamate } = fintoAdmin(true);
    const esito = await rivendicaIlCodiceSconto(
      { liberati: ['pc_1'], ancoraPagabili: [] },
      { admin, lettura: letturaCoupon(0) },
      { codice: 'UNICO1', subtotaleCents: 2000, userId: 'maria' },
    );
    expect(esito.ok).toBe(true);
    expect(chiamate).toEqual(['claim_coupon']);
    if (esito.ok) expect(esito.scontoCents).toBe(200);
  });

  it('se il contatore è ancora quello del tentativo vecchio, si dice esaurito e NON si consuma niente', async () => {
    const { admin, chiamate } = fintoAdmin(true);
    const esito = await rivendicaIlCodiceSconto(
      { liberati: [], ancoraPagabili: [] },
      { admin, lettura: letturaCoupon(1) },
      { codice: 'UNICO1', subtotaleCents: 2000, userId: 'maria' },
    );
    expect(esito.ok).toBe(false);
    if (!esito.ok) expect(esito.motivo).toBe('codice_non_valido');
    expect(chiamate, 'ha rivendicato un codice che aveva appena dichiarato esaurito').toEqual([]);
  });

  it('una pagina di pagamento rimasta viva ferma tutto: niente codice, nessuna seconda cassa', async () => {
    const { admin, chiamate } = fintoAdmin(true);
    const esito = await rivendicaIlCodiceSconto(
      { liberati: [], ancoraPagabili: ['cs_vecchia'] },
      { admin, lettura: letturaCoupon(0) },
      { codice: 'UNICO1', subtotaleCents: 2000, userId: 'maria' },
    );
    expect(esito.ok).toBe(false);
    if (!esito.ok) {
      expect(esito.motivo).toBe('pagamento_ancora_aperto');
      expect(esito.sessioni).toEqual(['cs_vecchia']);
    }
    expect(chiamate, 'ha consumato il codice mentre una cassa vecchia era ancora pagabile').toEqual([]);
  });

  it('senza codice non si chiede niente, ma il cancello vale lo stesso', async () => {
    const { admin, chiamate } = fintoAdmin(true);
    const senza = await rivendicaIlCodiceSconto(
      { liberati: [], ancoraPagabili: [] },
      { admin, lettura: letturaCoupon(0) },
      { codice: null, subtotaleCents: 2000, userId: 'maria' },
    );
    expect(senza).toEqual({ ok: true, codice: null, scontoCents: 0, spedizioneGratis: false });
    expect(chiamate).toEqual([]);

    const bloccato = await rivendicaIlCodiceSconto(
      { liberati: [], ancoraPagabili: ['cs_vecchia'] },
      { admin, lettura: letturaCoupon(0) },
      { codice: null, subtotaleCents: 2000, userId: 'maria' },
    );
    expect(bloccato.ok, 'senza codice la seconda cassa si apriva comunque').toBe(false);
  });

  it('il cancello puro: una sola pagina viva basta, i doppioni si contano una volta', () => {
    expect(laStradaELibera({ liberati: [], ancoraPagabili: [] }).libera).toBe(true);
    expect(laStradaELibera({ liberati: [], ancoraPagabili: ['a', 'a', ''] })).toEqual({ libera: false, sessioni: ['a'] });
  });
});

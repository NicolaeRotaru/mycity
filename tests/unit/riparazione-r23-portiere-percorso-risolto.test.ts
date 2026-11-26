import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R23 — IL PORTIERE (middleware.ts) CLASSIFICA IL PERCORSO CHE SCEGLIE LA PAGINA.
 *
 * La pagina si sceglie sul percorso decodificato: «/%73eller/dashboard» apre
 * /seller/dashboard. Il portiere deve decidere sullo stesso percorso, quindi
 * chi arriva da lì viene trattato come chi arriva da «/seller/dashboard».
 * Ogni caso si confronta col comportamento sul percorso in chiaro.
 */

type UtenteFinto = { id: string; email_confirmed_at: string | null } | null;
type RispostaUtente = { data: { user: UtenteFinto }; error?: unknown };

const getUser = vi.fn<() => Promise<RispostaUtente>>(async () => ({ data: { user: null } }));
const profiloLetto = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single: profiloLetto }) }) }),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

const NOME = 'sb-esempio-auth-token';
const CONFERMATO = '2026-01-01T00:00:00Z';

function richiesta(percorso: string, cookie: Record<string, string>) {
  const req = new NextRequest(new URL(`https://mycity.test${percorso}`));
  for (const [k, v] of Object.entries(cookie)) req.cookies.set(k, v);
  return req;
}

/** Il cookie come lo scrive @supabase/ssr: `base64-` + JSON della sessione. */
function cookieSessione(scadeFraSecondi: number): string {
  const sessione = {
    access_token: 'a',
    refresh_token: 'r',
    expires_at: Math.floor(Date.now() / 1000) + scadeFraSecondi,
  };
  const b64 = btoa(JSON.stringify(sessione)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `base64-${b64}`;
}

const SESSIONE_VALIDA = () => ({ [NOME]: cookieSessione(3600) });
const ANONIMO = () => ({});

function conProfilo(role: string | null, is_approved: boolean) {
  getUser.mockResolvedValue({ data: { user: { id: 'u-1', email_confirmed_at: CONFERMATO } } });
  profiloLetto.mockResolvedValue({ data: { role, is_approved } });
}

/** Quello che il portiere fa: stato e pagina verso cui rimanda (null se lascia passare). */
async function esito(percorso: string, cookie: Record<string, string>) {
  const res = await middleware(richiesta(percorso, cookie));
  const dove = res.headers.get('location');
  return { stato: res.status, verso: dove ? new URL(dove).pathname : null };
}

beforeEach(() => {
  getUser.mockReset();
  profiloLetto.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const CODIFICATI: Array<[string, string]> = [
  ['/%73eller/dashboard', '/seller/dashboard'],
  ['/s%65ller/orders', '/seller/orders'],
  ['/%61dmin', '/admin'],
  ['/%61dmin/users', '/admin/users'],
  ['/%72ider', '/rider'],
];

/** Percorsi che risolti cambierebbero: valgono come l'area più stretta. */
const CHE_RISOLTI_CAMBIANO = [
  '/x/..%2Fseller/dashboard',
  '/.%2Fadmin',
  '//seller/dashboard',
  '/%2Fseller/orders',
  '/seller/.%2Forders',
  '/seller/..%2Fx',
  '/admin/..%2F',
  '/seller/..%2Fproduct/abc',
  '/%5Cseller/dashboard',
];
const AREA_PIU_STRETTA = '/admin';

describe('il percorso scritto con caratteri codificati vale come quello in chiaro', () => {
  for (const [codificato, inChiaro] of CODIFICATI) {
    it(`anonimo su ${codificato}: come su ${inChiaro}`, async () => {
      const atteso = await esito(inChiaro, ANONIMO());
      expect(atteso.verso).toBe('/sign-in');
      expect(await esito(codificato, ANONIMO())).toEqual(atteso);
    });

    it(`acquirente su ${codificato}: come su ${inChiaro}`, async () => {
      conProfilo('buyer', true);
      const atteso = await esito(inChiaro, SESSIONE_VALIDA());
      expect(atteso.verso).not.toBe(null);
      expect(await esito(codificato, SESSIONE_VALIDA())).toEqual(atteso);
    });

    it(`utente senza ruolo su ${codificato}: come su ${inChiaro}`, async () => {
      conProfilo(null, false);
      const atteso = await esito(inChiaro, SESSIONE_VALIDA());
      expect(atteso.verso).not.toBe(null);
      expect(await esito(codificato, SESSIONE_VALIDA())).toEqual(atteso);
    });
  }
});

describe('un percorso che risolto cambia vale come l area piu stretta', () => {
  for (const percorso of CHE_RISOLTI_CAMBIANO) {
    it(`anonimo su ${percorso}: come su ${AREA_PIU_STRETTA}`, async () => {
      const atteso = await esito(AREA_PIU_STRETTA, ANONIMO());
      expect(atteso.verso).toBe('/sign-in');
      expect(await esito(percorso, ANONIMO())).toEqual(atteso);
    });

    it(`acquirente su ${percorso}: come su ${AREA_PIU_STRETTA}`, async () => {
      conProfilo('buyer', true);
      const atteso = await esito(AREA_PIU_STRETTA, SESSIONE_VALIDA());
      expect(atteso.verso).not.toBe(null);
      expect(await esito(percorso, SESSIONE_VALIDA())).toEqual(atteso);
    });
  }

  it('il negozio in revisione non entra da /seller/orders/..%2Fsubscription', async () => {
    conProfilo('seller', false);
    expect((await esito('/seller/orders/..%2Fsubscription', SESSIONE_VALIDA())).verso).not.toBe(null);
  });

  it('«..» scritto come %2e%2e lo risolve gia l indirizzo: il portiere decide sulla pagina servita', async () => {
    const coppie: Array<[string, string]> = [
      ['/seller/%2e%2e/x', '/x'],
      ['/admin/%2e%2e', '/'],
      ['/seller/orders/%2e%2e/subscription', '/seller/subscription'],
    ];
    for (const [scritto, servito] of coppie) {
      expect(richiesta(scritto, {}).nextUrl.pathname).toBe(servito);
      expect(await esito(scritto, ANONIMO())).toEqual(await esito(servito, ANONIMO()));
    }
    conProfilo('seller', false);
    expect(await esito('/seller/orders/%2e%2e/subscription', SESSIONE_VALIDA())).toEqual(
      await esito('/seller/subscription', SESSIONE_VALIDA()),
    );
  });

  it('la barra finale non cambia l area', async () => {
    conProfilo('buyer', true);
    expect(await esito('/%73eller/', SESSIONE_VALIDA())).toEqual(await esito('/seller/', SESSIONE_VALIDA()));
    conProfilo('seller', true);
    expect(await esito('/%73eller/dashboard/', SESSIONE_VALIDA())).toEqual(
      await esito('/seller/dashboard/', SESSIONE_VALIDA()),
    );
  });
});

describe('casi di controllo', () => {
  it('il negozio approvato su /%73eller/dashboard fa quello che fa su /seller/dashboard', async () => {
    conProfilo('seller', true);
    const atteso = await esito('/seller/dashboard', SESSIONE_VALIDA());
    expect(await esito('/%73eller/dashboard', SESSIONE_VALIDA())).toEqual(atteso);
  });

  it('il negozio in attesa su /s%65ller/orders fa quello che fa su /seller/orders', async () => {
    conProfilo('seller', false);
    const atteso = await esito('/seller/orders', SESSIONE_VALIDA());
    expect(await esito('/s%65ller/orders', SESSIONE_VALIDA())).toEqual(atteso);
  });

  it('l amministratore su /%61dmin/users entra come su /admin/users', async () => {
    conProfilo('admin', true);
    const atteso = await esito('/admin/users', SESSIONE_VALIDA());
    expect(atteso.verso).toBe(null);
    expect(await esito('/%61dmin/users', SESSIONE_VALIDA())).toEqual(atteso);
  });

  it('un percorso che non si decodifica non passa come pagina pubblica', async () => {
    const anonimo = await esito('/%E0%A4%A', ANONIMO());
    expect(anonimo.verso).not.toBe(null);
    expect(anonimo).toEqual(await esito('/admin', ANONIMO()));

    conProfilo('buyer', true);
    const acquirente = await esito('/%E0%A4%A', SESSIONE_VALIDA());
    expect(acquirente.verso).not.toBe(null);
    expect(acquirente).toEqual(await esito('/admin', SESSIONE_VALIDA()));
  });

  it('le pagine pubbliche restano aperte', async () => {
    for (const percorso of ['/', '/product/abc', '/product/%61bc']) {
      expect(await esito(percorso, ANONIMO())).toEqual({ stato: 200, verso: null });
    }
    conProfilo('buyer', true);
    for (const percorso of ['/', '/product/abc', '/product/%61bc']) {
      expect(await esito(percorso, SESSIONE_VALIDA())).toEqual({ stato: 200, verso: null });
    }
  });
});

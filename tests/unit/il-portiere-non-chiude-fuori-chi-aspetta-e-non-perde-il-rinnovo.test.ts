import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * ONDATA 10 — IL PORTIERE (middleware.ts), TRE DIFETTI SULLO STESSO CANCELLO.
 *
 * 1. Un negozio non ancora approvato veniva rimandato a /seller/dashboard, che
 *    sta anch'essa sotto /seller: il portiere lo rimandava di nuovo lì, all'infinito.
 * 2. Un amministratore promosso dal pannello (ruolo admin, is_approved=false)
 *    veniva rimandato alla home: l'approvazione non è un requisito del ruolo admin
 *    (le rotte /api admin guardano solo il ruolo).
 * 3. I cookie di sessione rinnovati da `getUser()` restavano sulla risposta
 *    scartata quando il portiere rimandava altrove, e un rinnovo più lento di
 *    tre secondi veniva abbandonato: il cliente restava con la tessera bruciata.
 */

type UtenteFinto = { id: string; email_confirmed_at: string | null } | null;
type RispostaUtente = { data: { user: UtenteFinto }; error?: unknown };
type CallbackCookie = {
  set: (nome: string, valore: string, opzioni: Record<string, unknown>) => void;
  remove: (nome: string, opzioni: Record<string, unknown>) => void;
};

let cookieDelClient: CallbackCookie | null = null;
const getUser = vi.fn<() => Promise<RispostaUtente>>(async () => ({ data: { user: null } }));
const profiloLetto = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opzioni: { cookies: CallbackCookie }) => {
    cookieDelClient = opzioni.cookies;
    return {
      auth: { getUser },
      from: () => ({ select: () => ({ eq: () => ({ single: profiloLetto }) }) }),
    };
  },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');
const { TETTO_PORTIERE_MS } = await import('@/lib/auth/decisione-portiere');
const { sessioneDaRinnovare } = await import('@/lib/auth/cookie-di-sessione');

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

function conProfilo(role: string, is_approved: boolean) {
  getUser.mockResolvedValue({ data: { user: { id: 'u-1', email_confirmed_at: CONFERMATO } } });
  profiloLetto.mockResolvedValue({ data: { role, is_approved } });
}

const SESSIONE_VALIDA = () => ({ [NOME]: cookieSessione(3600) });

beforeEach(() => {
  cookieDelClient = null;
  getUser.mockReset();
  profiloLetto.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('chi aspetta l approvazione non gira in tondo', () => {
  it('un negozio non approvato entra sulla dashboard, dove il layout mostra l attesa', async () => {
    conProfilo('seller', false);
    const res = await middleware(richiesta('/seller/dashboard', SESSIONE_VALIDA()));
    expect(res.headers.get('location'), 'il portiere rimanda la dashboard a se stessa: ciclo infinito').toBe(null);
    expect(res.status).toBe(200);
  });

  it('il resto del pannello resta chiuso al negozio non approvato', async () => {
    conProfilo('seller', false);
    const res = await middleware(richiesta('/seller/products', SESSIONE_VALIDA()));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/seller/dashboard');
  });

  it('un cliente sul pannello venditori torna alla home, come prima', async () => {
    conProfilo('buyer', true);
    const res = await middleware(richiesta('/seller/dashboard', SESSIONE_VALIDA()));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/');
  });

  it('un fattorino non approvato non entra: il reclutamento dal sito e chiuso (decisione 1 del 26/10)', async () => {
    conProfilo('rider', false);
    const res = await middleware(richiesta('/rider/onboarding', SESSIONE_VALIDA()));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/');
  });

  it('un amministratore promosso dal pannello entra nel pannello', async () => {
    conProfilo('admin', false);
    const res = await middleware(richiesta('/admin/users', SESSIONE_VALIDA()));
    expect(res.headers.get('location'), 'l admin appena promosso viene rimandato alla home').toBe(null);
    expect(res.status).toBe(200);
  });
});

describe('il rinnovo della sessione arriva al browser anche sui rimandi', () => {
  it('rimando alla verifica email: porta i cookie nuovi', async () => {
    getUser.mockImplementation(async () => {
      cookieDelClient!.set(NOME, 'gettone-nuovo', { path: '/' });
      return { data: { user: { id: 'u-1', email_confirmed_at: null } } };
    });
    const res = await middleware(richiesta('/profile', SESSIONE_VALIDA()));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/auth/verify-email');
    expect(res.cookies.get(NOME)?.value, 'la tessera nuova e rimasta sulla risposta scartata').toBe('gettone-nuovo');
  });

  it('rimando per ruolo: porta i cookie nuovi', async () => {
    profiloLetto.mockResolvedValue({ data: { role: 'buyer', is_approved: true } });
    getUser.mockImplementation(async () => {
      cookieDelClient!.set(NOME, 'gettone-nuovo', { path: '/' });
      return { data: { user: { id: 'u-1', email_confirmed_at: CONFERMATO } } };
    });
    const res = await middleware(richiesta('/admin', SESSIONE_VALIDA()));
    expect(res.status).toBe(307);
    expect(res.cookies.get(NOME)?.value).toBe('gettone-nuovo');
  });

  it('un rinnovo piu lento del tetto di lettura non viene abbandonato', async () => {
    profiloLetto.mockResolvedValue({ data: { role: 'buyer', is_approved: true } });
    getUser.mockImplementation(
      () =>
        new Promise<RispostaUtente>((risolvi) => {
          setTimeout(() => {
            cookieDelClient!.set(NOME, 'gettone-nuovo', { path: '/' });
            risolvi({ data: { user: { id: 'u-1', email_confirmed_at: CONFERMATO } } });
          }, TETTO_PORTIERE_MS + 500);
        }),
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // Tessera scaduta da dieci secondi: getUser() la rinnova, cioe' SCRIVE.
    const inCorso = middleware(richiesta('/profile', { [NOME]: cookieSessione(-10) }));
    await vi.advanceTimersByTimeAsync(TETTO_PORTIERE_MS + 600);
    const res = await inCorso;
    expect(res.headers.get('location'), 'il cliente e stato chiuso fuori mentre la sessione si rinnovava').toBe(null);
    expect(res.cookies.get(NOME)?.value, 'la tessera nuova non e arrivata al browser').toBe('gettone-nuovo');
  });
});

describe('quando getUser() rinnova la sessione', () => {
  it('tessera valida: e una lettura', () => {
    expect(sessioneDaRinnovare([{ name: NOME, value: cookieSessione(3600) }], Date.now())).toBe(false);
  });
  it('tessera scaduta o in scadenza: e una scrittura', () => {
    expect(sessioneDaRinnovare([{ name: NOME, value: cookieSessione(-10) }], Date.now())).toBe(true);
    expect(sessioneDaRinnovare([{ name: NOME, value: cookieSessione(30) }], Date.now())).toBe(true);
  });
  it('tessera spezzata in pezzi .0 .1: si ricompone', () => {
    const v = cookieSessione(-10);
    const meta = Math.floor(v.length / 2);
    const pezzi = [
      { name: `${NOME}.1`, value: v.slice(meta) },
      { name: `${NOME}.0`, value: v.slice(0, meta) },
    ];
    expect(sessioneDaRinnovare(pezzi, Date.now())).toBe(true);
  });
  it('cookie illeggibile: la libreria non ha niente da rinnovare', () => {
    expect(sessioneDaRinnovare([{ name: NOME, value: 'spazzatura' }], Date.now())).toBe(false);
    expect(sessioneDaRinnovare([], Date.now())).toBe(false);
  });
});

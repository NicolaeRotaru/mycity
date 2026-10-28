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

function b64url(s: string) {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const VERIFIER = { [`${NOME}-code-verifier`]: `base64-${b64url(JSON.stringify('verifier-abc123'))}` };

describe('collaudo A — varianti', () => {
  it('V1 sessioneDaRinnovare: tessera scaduta + cookie code-verifier rimasto (cambio email/reset password) = scrittura', () => {
    const c = [{ name: NOME, value: cookieSessione(-10) }, { name: `${NOME}-code-verifier`, value: VERIFIER[`${NOME}-code-verifier`] }];
    expect(sessioneDaRinnovare(c, Date.now())).toBe(true);
  });

  it('V1 middleware: rinnovo lento con code-verifier rimasto non viene abbandonato', async () => {
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
    const inCorso = middleware(richiesta('/profile', { [NOME]: cookieSessione(-10), ...VERIFIER }));
    await vi.advanceTimersByTimeAsync(TETTO_PORTIERE_MS + 600);
    const res = await inCorso;
    expect(res.headers.get('location'), 'cliente chiuso fuori mentre la sessione si rinnovava').toBe(null);
    expect(res.cookies.get(NOME)?.value).toBe('gettone-nuovo');
  });

  it('V2 rimando di ingresso in modalita acquisto (?shop=1): porta i cookie nuovi', async () => {
    profiloLetto.mockResolvedValue({ data: { role: 'seller', is_approved: true } });
    getUser.mockImplementation(async () => {
      cookieDelClient!.set(NOME, 'gettone-nuovo', { path: '/' });
      return { data: { user: { id: 'u-1', email_confirmed_at: CONFERMATO } } };
    });
    const res = await middleware(richiesta('/?shop=1', SESSIONE_VALIDA()));
    expect(res.status).toBe(307);
    expect(res.cookies.get(NOME)?.value).toBe('gettone-nuovo');
  });

  it('V3 negozio non approvato sulla dashboard con barra finale: entra', async () => {
    conProfilo('seller', false);
    const res = await middleware(richiesta('/seller/dashboard/', SESSIONE_VALIDA()));
    expect(res.headers.get('location')).toBe(null);
  });
});

describe("sessioneDaRinnovare legge solo la tessera, come la ricompone @supabase/ssr", () => {
  it("V1 tessera spezzata in pezzi .0/.1, scaduta, con code-verifier in mezzo: va rinnovata", () => {
    const intera = cookieSessione(-10);
    const meta = Math.floor(intera.length / 2);
    const c = [
      { name: `${NOME}.1`, value: intera.slice(meta) },
      { name: `${NOME}-code-verifier`, value: VERIFIER[`${NOME}-code-verifier`] },
      { name: `${NOME}.0`, value: intera.slice(0, meta) },
    ];
    expect(sessioneDaRinnovare(c, Date.now())).toBe(true);
  });

  it("V1 tessera buona con code-verifier rimasto: resta una lettura", () => {
    const c = [{ name: NOME, value: cookieSessione(3600) }, { name: `${NOME}-code-verifier`, value: VERIFIER[`${NOME}-code-verifier`] }];
    expect(sessioneDaRinnovare(c, Date.now())).toBe(false);
  });

  it("V1 solo il code-verifier, nessuna tessera: niente da rinnovare", () => {
    expect(sessioneDaRinnovare([{ name: `${NOME}-code-verifier`, value: VERIFIER[`${NOME}-code-verifier`] }], Date.now())).toBe(false);
  });
});

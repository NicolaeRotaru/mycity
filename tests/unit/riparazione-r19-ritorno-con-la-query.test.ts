/**
 * R19-020 (13/11/2026) — IL RITORNO DOPO L'ACCESSO NON PERDE ?tab=.
 *
 * Chi apre l'email «Annulla la cancellazione» senza sessione passa dal portiere,
 * che lo manda all'accesso con `returnTo`. `returnTo` teneva solo il percorso:
 * dopo l'accesso si tornava su /profile/settings, scheda Account, invece che sulla
 * scheda giusta. Qui si chiama il portiere vero, nei due rami che rimandano
 * all'accesso (nessuna tessera, tessera che non porta a nessuno), e si guarda
 * l'indirizzo di ritorno: porta la query e resta un percorso interno.
 */
import { describe, it, expect, vi } from 'vitest';

const getUser = vi.fn(async () => ({ data: { user: null }, error: null }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');
const { safeInternalPath } = await import('@/lib/safe-redirect');

function richiesta(percorso: string, cookie?: Record<string, string>) {
  const req = new NextRequest(new URL(`https://mycity.test${percorso}`));
  for (const [k, v] of Object.entries(cookie ?? {})) req.cookies.set(k, v);
  return req;
}

function ritornoDi(res: Response): { verso: URL; returnTo: string | null } {
  const dove = res.headers.get('location');
  expect(dove, 'il portiere non ha rimandato all\'accesso').toBeTruthy();
  const verso = new URL(dove!);
  return { verso, returnTo: verso.searchParams.get('returnTo') };
}

const SESSIONE = { 'sb-esempio-auth-token': 'gettone-che-non-porta-a-nessuno' };

describe('R19-020 · il ritorno dopo l\'accesso tiene la query', () => {
  it('senza sessione: returnTo porta ?tab= e la pagina di accesso lo accetta com\'è', async () => {
    const res = await middleware(richiesta('/profile/settings?tab=danger'));
    const { verso, returnTo } = ritornoDi(res);
    expect(verso.pathname).toBe('/sign-in');
    expect(returnTo, 'dopo l\'accesso si torna sulla scheda Account invece che su Zona pericolosa').toBe(
      '/profile/settings?tab=danger',
    );
    expect(safeInternalPath(returnTo), 'il ritorno deve restare un percorso interno').toBe(returnTo);
    expect(verso.searchParams.get('tab'), 'la query va dentro returnTo, non sulla pagina di accesso').toBeNull();
  });

  it('con una tessera che non porta a nessuno: stesso ritorno, con la query', async () => {
    const res = await middleware(richiesta('/profile/settings?tab=danger&da=email', SESSIONE));
    const { verso, returnTo } = ritornoDi(res);
    expect(verso.pathname).toBe('/sign-in');
    expect(returnTo).toBe('/profile/settings?tab=danger&da=email');
    expect(safeInternalPath(returnTo)).toBe(returnTo);
  });

  it('una query lunghissima non fa perdere anche il percorso', async () => {
    const lunga = `/profile/settings?x=${'a'.repeat(600)}`;
    const { returnTo } = ritornoDi(await middleware(richiesta(lunga)));
    expect(returnTo).toBe('/profile/settings');
  });

  it('senza query il ritorno resta il percorso di sempre', async () => {
    const { returnTo } = ritornoDi(await middleware(richiesta('/profile/orders')));
    expect(returnTo).toBe('/profile/orders');
  });
});

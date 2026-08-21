import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #86 — LA SCORCIATOIA SCRITTA NEL MIDDLEWARE NON SCATTAVA MAI SUL CATALOGO.
 *
 * C'è un'uscita rapida col commento «la maggior parte del traffico pubblico
 * esce subito», ma scatta solo se la pagina non richiede né autenticazione né
 * il gate dei venditori — e quel gate copre proprio tutte le pagine che
 * contano: home, prodotto, negozio, carrello, ricerca, categoria.
 *
 * Quindi per ogni visita al catalogo si costruiva un client Supabase e si
 * chiamava `auth.getUser()`, che con una sessione attiva non legge un cookie:
 * va a validare il token su Supabase. Subito dopo partiva una SELECT su
 * `profiles`. Due attese di rete infilate davanti a ogni pagina, per la
 * persona che compra.
 *
 * Qui si prova il comportamento vero: chiamando il middillware vero con e
 * senza cookie di sessione, e guardando se il client Supabase viene costruito.
 */

const createServerClient = vi.fn();
type UtenteFinto = { id: string; email_confirmed_at: string } | null;
const getUser = vi.fn<() => Promise<{ data: { user: UtenteFinto } }>>(
  async () => ({ data: { user: null } }),
);
const profiloLetto = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => {
    createServerClient(...args);
    return {
      auth: { getUser },
      from: () => ({
        select: () => ({
          eq: () => ({ single: profiloLetto }),
        }),
      }),
    };
  },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

function richiesta(percorso: string, cookie?: Record<string, string>) {
  const req = new NextRequest(new URL(`https://mycity.test${percorso}`));
  for (const [k, v] of Object.entries(cookie ?? {})) req.cookies.set(k, v);
  return req;
}

beforeEach(() => {
  createServerClient.mockClear();
  getUser.mockClear();
  profiloLetto.mockClear();
  getUser.mockResolvedValue({ data: { user: null } });
  profiloLetto.mockResolvedValue({ data: { role: 'buyer', is_approved: true } });
});

describe('il middleware non fa attese di rete quando non servono', () => {
  it('un visitatore anonimo sul catalogo non fa costruire nessun client Supabase', async () => {
    const res = await middleware(richiesta('/product/abc'));
    expect(res.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('lo stesso vale per la home e per un crawler', async () => {
    await middleware(richiesta('/'));
    await middleware(richiesta('/search?q=pane'));
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('senza sessione, una pagina protetta manda al login senza chiedere niente a Supabase', async () => {
    const res = await middleware(richiesta('/profile'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/sign-in');
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('con un cookie di sessione il controllo vero si fa eccome', async () => {
    await middleware(richiesta('/product/abc', { 'sb-esempio-auth-token': 'qualcosa' }));
    expect(createServerClient).toHaveBeenCalled();
    expect(getUser).toHaveBeenCalled();
  });

  it('il ruolo si rilegge una volta e poi sta nel cookie per dieci minuti', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'u-1', email_confirmed_at: '2026-01-01T00:00:00Z' } },
    });

    const primo = await middleware(richiesta('/product/abc', { 'sb-esempio-auth-token': 'x' }));
    expect(profiloLetto).toHaveBeenCalledTimes(1);

    const cookieRuolo = primo.cookies.get('mc_ruolo');
    expect(cookieRuolo, 'il ruolo non è stato messo in cache').toBeTruthy();

    // Secondo giro con quel cookie: niente seconda lettura del profilo.
    await middleware(richiesta('/product/abc', {
      'sb-esempio-auth-token': 'x',
      mc_ruolo: cookieRuolo!.value,
    }));
    expect(profiloLetto).toHaveBeenCalledTimes(1);
  });

  it('sulle aree protette il profilo si rilegge sempre: un ruolo vecchio non vale', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'u-1', email_confirmed_at: '2026-01-01T00:00:00Z' } },
    });
    profiloLetto.mockResolvedValue({ data: { role: 'admin', is_approved: true } });

    const primo = await middleware(richiesta('/admin', { 'sb-esempio-auth-token': 'x' }));
    const cookieRuolo = primo.cookies.get('mc_ruolo');
    expect(profiloLetto).toHaveBeenCalledTimes(1);

    await middleware(richiesta('/admin', {
      'sb-esempio-auth-token': 'x',
      mc_ruolo: cookieRuolo?.value ?? '',
    }));
    // Su /admin la cache non si usa: seconda lettura vera.
    expect(profiloLetto).toHaveBeenCalledTimes(2);
  });

  it('un cookie di ruolo non firmato viene buttato via', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'u-1', email_confirmed_at: '2026-01-01T00:00:00Z' } },
    });
    await middleware(richiesta('/product/abc', {
      'sb-esempio-auth-token': 'x',
      mc_ruolo: 'u-1|admin|1.firma-inventata',
    }));
    // Non ci si fida: si rilegge il profilo vero.
    expect(profiloLetto).toHaveBeenCalledTimes(1);
  });

  it('il cookie di ruolo di un altro utente non vale', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'u-1', email_confirmed_at: '2026-01-01T00:00:00Z' } },
    });
    const primo = await middleware(richiesta('/product/abc', { 'sb-esempio-auth-token': 'x' }));
    const cookieRuolo = primo.cookies.get('mc_ruolo')!.value;

    profiloLetto.mockClear();
    getUser.mockResolvedValue({
      data: { user: { id: 'u-2', email_confirmed_at: '2026-01-01T00:00:00Z' } },
    });
    await middleware(richiesta('/product/abc', {
      'sb-esempio-auth-token': 'x',
      mc_ruolo: cookieRuolo,
    }));
    expect(profiloLetto).toHaveBeenCalledTimes(1);
  });
});

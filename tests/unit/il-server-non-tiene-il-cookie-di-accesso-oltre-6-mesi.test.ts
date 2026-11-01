import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 31/10/2026 (ondata 6) — LA COOKIE POLICY PROMETTE 6 MESI, IL SERVER SCRIVEVA 400 GIORNI.
 *
 * Il cookie di accesso (sb-*-auth-token) lo scrive @supabase/ssr 0.5.2, che gli mette
 * maxAge = 400 giorni (dist/main/utils/constants.js) e lo impone anche sopra le nostre
 * opzioni. Il browser lo tagliava già a 6 mesi (lib/supabase/client.ts), ma a ogni
 * rinnovo della sessione il server — il middleware e i client delle pagine — lo
 * riscriveva a 400 giorni. Scelta di Nicola del 31/10 (fatto privacy.consenso-cookie-durata):
 * 6 mesi, come la scelta sui cookie, e la policy dice quello.
 *
 * La libreria qui è finta solo per una ragione: le facciamo dire quello che dice la vera
 * (400 giorni) e guardiamo che cosa esce davvero verso il browser.
 */

const SEI_MESI_S = 180 * 24 * 60 * 60;
const QUATTROCENTO_GIORNI_S = 400 * 24 * 60 * 60;

type Opzioni = { cookies: { set: (n: string, v: string, o: Record<string, unknown>) => void } };
const { catturate, scritti } = vi.hoisted(() => ({
  catturate: [] as Opzioni[],
  scritti: [] as Array<Record<string, unknown>>,
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_u: string, _k: string, opzioni: Opzioni) => {
    catturate.push(opzioni);
    return {
      auth: {
        // Come fa la libreria quando rinnova la sessione: riscrive il cookie a 400 giorni.
        getUser: async () => {
          opzioni.cookies.set('sb-esempio-auth-token', 'rinnovato', { path: '/', sameSite: 'lax', maxAge: QUATTROCENTO_GIORNI_S });
          return { data: { user: null } };
        },
      },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }), maybeSingle: async () => ({ data: null }) }) }) }),
    };
  },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    set: (o: Record<string, unknown>) => {
      scritti.push(o);
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'eyJ' + 'a'.repeat(60);
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

beforeEach(() => {
  catturate.length = 0;
  scritti.length = 0;
});

describe('il cookie di accesso scritto dal server non dura più dei 6 mesi della cookie policy', () => {
  it('le pagine (getServerSupabase) lo tagliano a 6 mesi', async () => {
    const { getServerSupabase } = await import('@/lib/supabase/server');
    await getServerSupabase();
    const opzioni = catturate.at(-1);
    expect(opzioni, 'il client del server deve nascere').toBeDefined();
    opzioni!.cookies.set('sb-esempio-auth-token', 'rinnovato', { path: '/', maxAge: QUATTROCENTO_GIORNI_S });
    const sessione = scritti.filter((o) => o.name === 'sb-esempio-auth-token');
    expect(sessione.length, 'il cookie di sessione deve essere scritto').toBe(1);
    expect(sessione[0].maxAge, 'Max-Age in secondi').toBeLessThanOrEqual(SEI_MESI_S);
  });

  it('il middleware, che rinnova la sessione a ogni visita, lo taglia a 6 mesi', async () => {
    const { middleware } = await import('@/middleware');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest(new URL('https://mycity.test/profile'));
    req.cookies.set('sb-esempio-auth-token', 'vecchio');
    const res = await middleware(req);
    const righe = res.headers.getSetCookie().filter((r) => r.startsWith('sb-esempio-auth-token=rinnovato'));
    expect(righe.length, 'il middleware deve rimandare al browser il cookie rinnovato').toBeGreaterThan(0);
    for (const riga of righe) {
      const maxAge = Number(/Max-Age=(\d+)/i.exec(riga)?.[1]);
      expect(maxAge, riga).toBeLessThanOrEqual(SEI_MESI_S);
    }
  });
});

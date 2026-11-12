/**
 * R06-007 (12/11/2026) — «LA SESSIONE VA RINNOVATA?» PROVATO CON LA LIBRERIA VERA.
 *
 * `sessioneDaRinnovare` ricopia a mano tre regole di @supabase/ssr e auth-js: i
 * pezzi .0/.1, il prefisso base64- e il margine di scadenza. Le prove di prima
 * costruivano i cookie a mano. Qui i cookie li SCRIVE la libreria vera
 * (createServerClient con un barattolo di cookie finto): se un giorno cambia
 * formato, questa prova diventa rossa invece di lasciare il portiere, in
 * silenzio, al tetto di tre secondi mentre getUser rinnova.
 *
 * In piu' i casi scoperti: la tessera in JSON grezzo senza base64-, la tessera
 * intera accanto ai pezzi, due progetti sullo stesso dominio.
 */
import { describe, it, expect } from 'vitest';
import { createServerClient } from '@supabase/ssr';
import { sessioneDaRinnovare } from '@/lib/auth/cookie-di-sessione';

type Cookie = { name: string; value: string };
type Sessione = Record<string, unknown>;

const ADESSO = Date.now();

function sessione(scadeFraSecondi: number, lunghezzaGettone = 200): Sessione {
  return {
    access_token: 'a'.repeat(lunghezzaGettone),
    refresh_token: 'r',
    expires_in: 3600,
    expires_at: Math.floor(ADESSO / 1000) + scadeFraSecondi,
    token_type: 'bearer',
    user: { id: 'u-1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
  };
}

/**
 * Fa scrivere i cookie della sessione alla libreria vera, come dopo un rinnovo.
 * `_saveSession` e `_notifyAllSubscribers` sono interni di auth-js: sono la
 * strada che la libreria stessa percorre quando rinnova la tessera.
 */
async function cookieScrittiDallaLibreria(
  s: Sessione,
  opzioni: { progetto?: string; cookieEncoding?: 'raw' | 'base64url' } = {},
): Promise<Cookie[]> {
  const barattolo = new Map<string, string>();
  const client = createServerClient(`https://${opzioni.progetto ?? 'progetto'}.supabase.co`, 'chiave-finta', {
    global: { fetch: async () => new Response('{}', { status: 500 }) },
    ...(opzioni.cookieEncoding ? { cookieEncoding: opzioni.cookieEncoding } : {}),
    cookies: {
      getAll: () => [...barattolo].map(([name, value]) => ({ name, value })),
      setAll: (lista) => {
        for (const { name, value } of lista) {
          if (value) barattolo.set(name, value);
          else barattolo.delete(name);
        }
      },
    },
  });
  const auth = client.auth as unknown as {
    _saveSession: (s: Sessione) => Promise<void>;
    _notifyAllSubscribers: (evento: string, s: Sessione) => Promise<void>;
  };
  await auth._saveSession(s);
  await auth._notifyAllSubscribers('TOKEN_REFRESHED', s);
  return [...barattolo].map(([name, value]) => ({ name, value }));
}

describe('R06-007 · sessioneDaRinnovare sui cookie scritti da @supabase/ssr', () => {
  it('la libreria scrive davvero la tessera (se smette, la prova lo dice)', async () => {
    const cookie = await cookieScrittiDallaLibreria(sessione(3600));
    expect(cookie.length).toBeGreaterThan(0);
    expect(cookie.every((c) => /^sb-progetto-auth-token(\.\d+)?$/.test(c.name))).toBe(true);
  });

  it('tessera corta (un cookie solo), buona per un\'ora: non va rinnovata', async () => {
    const cookie = await cookieScrittiDallaLibreria(sessione(3600));
    expect(cookie.map((c) => c.name)).toEqual(['sb-progetto-auth-token']);
    expect(sessioneDaRinnovare(cookie, ADESSO)).toBe(false);
  });

  it('tessera corta in scadenza: va rinnovata', async () => {
    const cookie = await cookieScrittiDallaLibreria(sessione(30));
    expect(sessioneDaRinnovare(cookie, ADESSO)).toBe(true);
  });

  it('tessera lunga spezzata in pezzi .0/.1/.2, in scadenza: va rinnovata', async () => {
    const cookie = await cookieScrittiDallaLibreria(sessione(30, 5000));
    expect(cookie.length, 'la libreria non ha spezzato la tessera: il caso dei pezzi non e\' piu\' provato').toBeGreaterThan(1);
    expect(sessioneDaRinnovare(cookie, ADESSO)).toBe(true);
  });

  it('tessera lunga spezzata in pezzi, buona per un\'ora: non va rinnovata', async () => {
    const cookie = await cookieScrittiDallaLibreria(sessione(3600, 5000));
    expect(cookie.length).toBeGreaterThan(1);
    expect(sessioneDaRinnovare(cookie, ADESSO)).toBe(false);
  });

  it('tessera in JSON grezzo, senza base64- (cookieEncoding raw): in scadenza va rinnovata', async () => {
    const cookie = await cookieScrittiDallaLibreria(sessione(30), { cookieEncoding: 'raw' });
    expect(cookie[0]?.value.startsWith('base64-'), 'la libreria ha scritto base64- anche in modo raw').toBe(false);
    expect(sessioneDaRinnovare(cookie, ADESSO)).toBe(true);
  });

  it('tessera in JSON grezzo, buona per un\'ora: non va rinnovata', async () => {
    const cookie = await cookieScrittiDallaLibreria(sessione(3600), { cookieEncoding: 'raw' });
    expect(sessioneDaRinnovare(cookie, ADESSO)).toBe(false);
  });

  it('tessera intera accanto ai pezzi: vale l\'intera, come per la libreria', async () => {
    const intera = await cookieScrittiDallaLibreria(sessione(30));
    const pezzi = await cookieScrittiDallaLibreria(sessione(3600, 5000));
    // L'intera e' in scadenza, i pezzi (vecchi) sono buoni: la libreria legge l'intera e rinnova.
    expect(sessioneDaRinnovare([...pezzi, ...intera], ADESSO)).toBe(true);
    // Al contrario: intera buona, pezzi in scadenza → la libreria legge l'intera e non rinnova.
    const interaBuona = await cookieScrittiDallaLibreria(sessione(3600));
    const pezziScaduti = await cookieScrittiDallaLibreria(sessione(30, 5000));
    expect(sessioneDaRinnovare([...pezziScaduti, ...interaBuona], ADESSO)).toBe(false);
  });

  it('due progetti sullo stesso dominio: basta che uno vada rinnovato', async () => {
    const buono = await cookieScrittiDallaLibreria(sessione(3600), { progetto: 'primo' });
    const inScadenza = await cookieScrittiDallaLibreria(sessione(30, 5000), { progetto: 'secondo' });
    expect(sessioneDaRinnovare([...buono, ...inScadenza], ADESSO)).toBe(true);
    expect(sessioneDaRinnovare(buono, ADESSO)).toBe(false);
  });
});

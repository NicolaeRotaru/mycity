import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/11/2026 — LA SESSIONE DEL TITOLARE DAL LINK (lib/agenzia/entra-dal-link.ts).
 *
 * Casi (dato → atteso):
 *  · nessuno dentro → non è «un altro»: si può entrare;
 *  · dentro c'è lo stesso negozio → non è «un altro»;
 *  · dentro c'è un altro account → è «un altro»: la sua sessione non si tocca;
 *  · la domanda «chi c'è dentro?» non risponde in tempo, o si rompe → prudenza: come «un altro»;
 *  · il gettone apre la sessione → vero, e i cookie scritti da Supabase finiscono in `scritti`
 *    (anche le cancellazioni); il gettone va a `verifyOtp` come token_hash di un magiclink;
 *  · il gettone non apre la sessione → falso;
 *  · i cookie della richiesta arrivano a Supabase, anche codificati;
 *  · senza chiavi pubbliche → null.
 */

const finto = vi.hoisted(() => ({
  utente: null as null | { id: string },
  getUser: null as null | (() => Promise<unknown>),
  verifica: { session: { access_token: 'a' } as unknown, error: null as null | { code: string } },
  chiamateVerifica: [] as unknown[],
  cookie: null as null | {
    get: (n: string) => string | undefined;
    set: (n: string, v: string, o: Record<string, unknown>) => void;
    remove: (n: string, o: Record<string, unknown>) => void;
  },
  chiavi: true,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({
  requireSupabasePublic: () => {
    if (!finto.chiavi) throw new Error('Variabili Supabase mancanti');
    return { url: 'https://supabase.test', key: 'anon' };
  },
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_u: string, _k: string, opzioni: { cookies: NonNullable<typeof finto.cookie> }) => {
    finto.cookie = opzioni.cookies;
    return {
      auth: {
        getUser: () => (finto.getUser ? finto.getUser() : Promise.resolve({ data: { user: finto.utente }, error: null })),
        verifyOtp: async (a: unknown) => {
          finto.chiamateVerifica.push(a);
          if (!finto.verifica.error) {
            finto.cookie!.set('sb-test-auth-token', 'base64-nuova', { path: '/', maxAge: 400 * 24 * 3600 });
            finto.cookie!.remove('sb-test-auth-token-code-verifier', { path: '/', maxAge: 0 });
          }
          return { data: { session: finto.verifica.error ? null : finto.verifica.session }, error: finto.verifica.error };
        },
      },
    };
  },
}));

import { sessioneDalLink } from '@/lib/agenzia/entra-dal-link';
import { DURATA_MASSIMA_SESSIONE_S } from '@/lib/auth/cookie-di-sessione';

beforeEach(() => {
  finto.utente = null;
  finto.getUser = null;
  finto.verifica = { session: { access_token: 'a' }, error: null };
  finto.chiamateVerifica = [];
  finto.cookie = null;
  finto.chiavi = true;
});

describe('chi c è già dentro', () => {
  it('nessuno, o lo stesso negozio: si può entrare', async () => {
    expect(await sessioneDalLink(null)!.dentroUnAltro('gc-1')).toBe(false);
    finto.utente = { id: 'gc-1' };
    expect(await sessioneDalLink('x=1')!.dentroUnAltro('gc-1')).toBe(false);
  });

  it('un altro account (Nicola che prova il link): non si tocca', async () => {
    finto.utente = { id: 'admin-nicola' };
    expect(await sessioneDalLink('sb-test-auth-token=abc')!.dentroUnAltro('gc-1')).toBe(true);
  });

  it('se Supabase risponde con un errore di rete invece di lanciare, si resta prudenti (collaudo M1)', async () => {
    // auth-js non lancia sugli errori di rete e sui 5xx: restituisce { user: null, error }.
    finto.getUser = async () => ({ data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 0 } });
    expect(await sessioneDalLink('sb-test-auth-token=abc')!.dentroUnAltro('gc-1')).toBe(true);
    finto.getUser = async () => ({ data: { user: null }, error: { name: 'AuthApiError', status: 500 } });
    expect(await sessioneDalLink('sb-test-auth-token=abc')!.dentroUnAltro('gc-1')).toBe(true);
    // Nessuna sessione nel browser: è il caso del telefono del titolare, si entra.
    finto.getUser = async () => ({ data: { user: null }, error: { name: 'AuthSessionMissingError', status: 400 } });
    expect(await sessioneDalLink(null)!.dentroUnAltro('gc-1')).toBe(false);
  });

  it('dopo una risposta veloce non resta nessun timer acceso (collaudo M4)', async () => {
    vi.useFakeTimers();
    try {
      expect(await sessioneDalLink(null)!.dentroUnAltro('gc-1')).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('se non risponde in tempo o si rompe, si resta prudenti', async () => {
    finto.getUser = () => new Promise(() => undefined);
    expect(await sessioneDalLink(null, 20)!.dentroUnAltro('gc-1')).toBe(true);
    finto.getUser = () => Promise.reject(new Error('rete'));
    expect(await sessioneDalLink(null)!.dentroUnAltro('gc-1')).toBe(true);
  });
});

describe('il gettone apre la sessione', () => {
  it('va a verifyOtp come magiclink, e i cookie scritti (anche le cancellazioni) si raccolgono', async () => {
    const s = sessioneDalLink(null)!;
    expect(await s.entra('hash-1')).toBe(true);
    expect(finto.chiamateVerifica).toEqual([{ token_hash: 'hash-1', type: 'magiclink' }]);
    expect(s.scritti.map((c) => [c.name, c.value])).toEqual([
      ['sb-test-auth-token', 'base64-nuova'],
      ['sb-test-auth-token-code-verifier', ''],
    ]);
    // La durata della sessione resta sotto il tetto del sito (lib/auth/cookie-di-sessione.ts).
    expect(Number(s.scritti[0].options.maxAge)).toBeLessThanOrEqual(DURATA_MASSIMA_SESSIONE_S);
  });

  it('un gettone che non apre la sessione dice di no', async () => {
    finto.verifica = { session: null, error: { code: 'otp_expired' } };
    const s = sessioneDalLink(null)!;
    expect(await s.entra('hash-vecchio')).toBe(false);
    expect(s.scritti).toEqual([]);
  });

  it('i cookie della richiesta arrivano a Supabase, anche codificati', () => {
    sessioneDalLink('a=1; sb-test-auth-token=base64%2Dabc; vuoto=; =senza-nome')!;
    expect(finto.cookie!.get('a')).toBe('1');
    expect(finto.cookie!.get('sb-test-auth-token')).toBe('base64-abc');
    expect(finto.cookie!.get('vuoto')).toBe('');
    expect(finto.cookie!.get('')).toBeUndefined();
  });

  it('senza le chiavi pubbliche non si apre niente', () => {
    finto.chiavi = false;
    expect(sessioneDalLink(null)).toBeNull();
  });
});

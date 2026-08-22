import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 22/8/2026 — «DEVI ACCEDERE» DETTO A CHI È GIÀ DENTRO.
 *
 * Se le variabili Supabase mancano, il client server non si crea. Prima
 * `getCurrentUser()` restituiva `null` per QUALUNQUE guasto, e chi chiamava
 * leggeva quel null come «non c'è nessuna sessione»: rispondeva 401
 * «Autenticazione richiesta». Chi era regolarmente loggato riprovava ad
 * accedere all'infinito, e nei log non restava niente.
 *
 * Venti righe più sotto, nello stesso file, lo stesso identico guasto sul
 * caricamento del profilo rispondeva già 503 «Auth non configurato».
 *
 * Questa prova pretende 503, non 401. Togli il distinguo in
 * lib/supabase/server.ts e torna rossa.
 */

const getUser = vi.fn();
const cookiesMock = vi.fn();

vi.mock('next/headers', () => ({ cookies: () => cookiesMock() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

describe('un guasto di configurazione non è un login mancante', () => {
  beforeEach(() => {
    vi.resetModules();
    getUser.mockReset();
    cookiesMock.mockReset();
  });

  it('senza le variabili Supabase, getCurrentUser LANCIA invece di dire «nessuno»', async () => {
    // requireSupabasePublic() lancia quando le variabili mancano: è il guasto
    // vero che il vecchio catch inghiottiva.
    vi.doMock('@/lib/env', () => ({
      requireSupabasePublic: () => {
        throw new Error('Variabili Supabase mancanti: NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY');
      },
      requireSupabaseService: () => ({ url: 'x', key: 'y' }),
      env: {},
    }));
    cookiesMock.mockResolvedValue({ get: () => undefined, set: () => {}, delete: () => {} });

    const { getCurrentUser, AuthNonDisponibile } = await import('@/lib/supabase/server');
    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthNonDisponibile);
  });

  it('con le variabili a posto e nessuna sessione, restituisce null (401 resta giusto)', async () => {
    vi.doMock('@/lib/env', () => ({
      requireSupabasePublic: () => ({ url: 'https://x.supabase.co', key: 'anon' }),
      requireSupabaseService: () => ({ url: 'https://x.supabase.co', key: 'srv' }),
      env: {},
    }));
    vi.doMock('@supabase/ssr', () => ({
      createServerClient: () => ({ auth: { getUser } }),
    }));
    cookiesMock.mockResolvedValue({ get: () => undefined, set: () => {}, delete: () => {} });
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });

    const { getCurrentUser } = await import('@/lib/supabase/server');
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it('se la domanda esplode a metà, LANCIA: non è «nessuna sessione»', async () => {
    vi.doMock('@/lib/env', () => ({
      requireSupabasePublic: () => ({ url: 'https://x.supabase.co', key: 'anon' }),
      requireSupabaseService: () => ({ url: 'https://x.supabase.co', key: 'srv' }),
      env: {},
    }));
    vi.doMock('@supabase/ssr', () => ({
      createServerClient: () => ({ auth: { getUser } }),
    }));
    cookiesMock.mockResolvedValue({ get: () => undefined, set: () => {}, delete: () => {} });
    getUser.mockRejectedValue(new Error('fetch failed'));

    const { getCurrentUser, AuthNonDisponibile } = await import('@/lib/supabase/server');
    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthNonDisponibile);
  });
});

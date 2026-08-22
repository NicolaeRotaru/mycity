import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 22/8/2026 — DUE COPIE DELLA STESSA COSA NON RESTANO UGUALI.
 *
 * `lib/supabase/auth-server.ts` e `lib/api/middleware.ts` creavano tutti e due
 * un client anonimo che vive quanto una richiesta. Stessa identica cosa, due
 * implementazioni, e già divergenti: la prima passava anche
 * `detectSessionInUrl: false`, la seconda no. Anche le variabili le leggevano
 * in due modi diversi, e la seconda — quando mancavano — restituiva `null`
 * invece di dire quale mancava.
 *
 * Questa prova pretende che le opzioni siano IDENTICHE. Rimetti una seconda
 * fabbrica con impostazioni sue e torna rossa.
 */

const createClient = vi.fn(() => ({ auth: {} }));

vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@/lib/env', () => ({
  requireSupabasePublic: () => ({ url: 'https://x.supabase.co', key: 'anon-key' }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

describe('una sola fabbrica di client anonimi', () => {
  beforeEach(() => {
    vi.resetModules();
    createClient.mockClear();
  });

  it('la fabbrica spegne sessione, rinnovo automatico e lettura della sessione dall’indirizzo', async () => {
    const { creaClientAnonimo } = await import('@/lib/supabase/anonimo');
    creaClientAnonimo();

    expect(createClient).toHaveBeenCalledTimes(1);
    const [url, key, opzioni] = createClient.mock.calls[0] as unknown as [
      string,
      string,
      { auth: Record<string, boolean> },
    ];
    expect(url).toBe('https://x.supabase.co');
    expect(key).toBe('anon-key');
    expect(opzioni.auth).toEqual({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    });
  });

  it('due client creati di fila hanno le stesse identiche opzioni', async () => {
    const { creaClientAnonimo } = await import('@/lib/supabase/anonimo');
    creaClientAnonimo();
    creaClientAnonimo();

    const primo = createClient.mock.calls[0];
    const secondo = createClient.mock.calls[1];
    expect(secondo).toEqual(primo);
  });

  it('non è un singleton: ogni richiesta ha il suo', async () => {
    // Il singleton del browser è proprio il difetto che questa fabbrica evita:
    // una variabile di modulo condivisa fra tutte le richieste dello stesso
    // processo Node, dove la sessione di uno può finire in mano a un altro.
    const { creaClientAnonimo } = await import('@/lib/supabase/anonimo');
    creaClientAnonimo();
    creaClientAnonimo();
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it('quando le variabili mancano, LANCIA con scritto cosa manca', async () => {
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({
      requireSupabasePublic: () => {
        throw new Error('Variabili Supabase mancanti: NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY');
      },
    }));
    const { creaClientAnonimo } = await import('@/lib/supabase/anonimo');
    expect(() => creaClientAnonimo()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});

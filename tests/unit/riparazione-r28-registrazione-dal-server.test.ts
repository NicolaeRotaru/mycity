/**
 * 26/11/2026 (R28-013) — LA ROTTA DI REGISTRAZIONE PORTA I DATI DELL'ISCRIZIONE
 * E VERIFICA IL GETTONE UNA VOLTA SOLA.
 *
 * La pagina /sign-up passa a Supabase ruolo, nome e versione dei testi accettati.
 * La rotta del server no: un account creato da lì nasceva senza ruolo scelto e
 * senza versione dei Termini. E col CAPTCHA acceso su Supabase il gettone,
 * verificato prima qui e poi da Supabase, cadeva alla seconda verifica.
 *
 * Supabase finto (authServer.signUp) e Cloudflare finto (verifyTurnstileToken):
 * si guarda cosa arriva davvero a Supabase.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const stato = vi.hoisted(() => ({
  iscrizioni: [] as Array<{ email: string; password: string; options?: Record<string, unknown> }>,
  verifiche: [] as Array<string | null | undefined>,
  errore: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/supabase/auth-server', () => ({
  authServer: {
    signUp: async (email: string, password: string, options?: Record<string, unknown>) => {
      stato.iscrizioni.push({ email, password, options });
      return stato.errore
        ? { data: { user: null, session: null }, error: stato.errore }
        : { data: { user: { id: 'nuovo' }, session: null }, error: null };
    },
  },
}));
vi.mock('@/lib/captcha', () => ({
  verifyTurnstileToken: async (gettone: string | null | undefined) => {
    stato.verifiche.push(gettone);
    return gettone ? { ok: true } : { ok: false, reason: 'CAPTCHA mancante' };
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }),
  getClientIp: () => '10.0.0.28',
}));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://mycity.test' } }));

import { POST } from '@/app/api/auth/signup/route';

function iscrivi(corpo: Record<string, unknown>) {
  return POST(
    new Request('https://mycity.test/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
  );
}

const BASE = { email: 'giulia@esempio.it', password: 'una-password-lunga', captchaToken: 'gettone-1' };

beforeEach(() => {
  stato.iscrizioni.length = 0;
  stato.verifiche.length = 0;
  stato.errore = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('R28-013 · i dati dell’iscrizione arrivano a Supabase', () => {
  it('IL CASO CHE ROMPEVA — ruolo, nome e versione dei testi viaggiano in options.data', async () => {
    const res = await iscrivi({
      ...BASE,
      role: 'seller',
      full_name: '  Giulia Verdi  ',
      versione_testi_accettati: 'privacy-2.0+terms-3.0',
    });
    expect(res.status).toBe(201);
    expect(stato.iscrizioni).toHaveLength(1);
    expect(stato.iscrizioni[0].options?.data).toEqual({
      role: 'seller',
      full_name: 'Giulia Verdi',
      versione_testi_accettati: 'privacy-2.0+terms-3.0',
    });
  });

  it('un ruolo fuori dai tre della pagina diventa cliente; il nome vuoto non si manda', async () => {
    await iscrivi({ ...BASE, role: 'admin', full_name: '   ', versione_testi_accettati: 'privacy-2.0+terms-3.0' });
    expect(stato.iscrizioni[0].options?.data).toEqual({ role: 'buyer', versione_testi_accettati: 'privacy-2.0+terms-3.0' });
  });

  it('il nome ha lo stesso tetto del grilletto (200 caratteri)', async () => {
    await iscrivi({ ...BASE, role: 'rider', full_name: 'A'.repeat(250) });
    const dati = stato.iscrizioni[0].options?.data as { role: string; full_name: string };
    expect(dati.role).toBe('rider');
    expect(dati.full_name).toHaveLength(200);
  });
});

describe('R28-013 · il gettone anti-robot si verifica una volta sola', () => {
  it('col CAPTCHA acceso su Supabase il server non lo spende: lo passa a Supabase', async () => {
    vi.stubEnv('CAPTCHA_SU_SUPABASE_ACCESO', '1');
    const res = await iscrivi({ ...BASE, role: 'buyer' });
    expect(res.status).toBe(201);
    expect(stato.verifiche, 'il server ha speso il gettone prima di Supabase').toHaveLength(0);
    expect(stato.iscrizioni[0].options?.captchaToken).toBe('gettone-1');
  });

  it('con la variabile spenta verifica il server, come prima, e un gettone mancante ferma l’iscrizione', async () => {
    vi.stubEnv('CAPTCHA_SU_SUPABASE_ACCESO', '');
    expect((await iscrivi({ ...BASE, role: 'buyer' })).status).toBe(201);
    expect(stato.verifiche).toEqual(['gettone-1']);

    const senza = await iscrivi({ ...BASE, captchaToken: undefined, role: 'buyer' });
    expect(senza.status).toBe(400);
    expect(stato.iscrizioni).toHaveLength(1);
  });

  it('il gettone rifiutato da Supabase non si legge come «controlla i dati»', async () => {
    vi.stubEnv('CAPTCHA_SU_SUPABASE_ACCESO', '1');
    stato.errore = { name: 'AuthApiError', status: 400, code: 'captcha_failed', message: 'captcha protection: request disallowed (timeout-or-duplicate)' };
    const res = await iscrivi({ ...BASE, role: 'buyer' });
    expect(res.status).toBe(400);
    const testo = JSON.stringify(await res.json());
    expect(testo).toMatch(/CAPTCHA non valido/);
    expect(testo).not.toMatch(/Controlla i dati/);
  });
});

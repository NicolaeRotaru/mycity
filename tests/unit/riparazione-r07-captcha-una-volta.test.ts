/**
 * 26/11/2026 (R07-001) — IL GETTONE ANTI-ROBOT SI SPENDE UNA VOLTA SOLA.
 *
 * Un gettone Cloudflare Turnstile vale una volta: la seconda verifica risponde
 * «timeout-or-duplicate». La rotta di accesso lo verificava sul server e poi lo
 * passava a Supabase. Finché il CAPTCHA di Supabase resta spento, Supabase lo
 * ignora e non succede niente; il giorno che lo si accende, ogni accesso con
 * email cade alla seconda verifica.
 *
 * Qui Cloudflare è finto ma si comporta come quello vero (un gettone, un uso), e
 * il Supabase finto, col suo CAPTCHA acceso, chiede a Cloudflare il gettone che
 * riceve, come fa il vero. Si prova che:
 *  - con CAPTCHA_SU_SUPABASE_ACCESO il server non chiama siteverify e l'accesso
 *    riesce, col gettone speso una volta sola (da Supabase);
 *  - con la variabile spenta verifica il server, una volta sola, e un gettone
 *    rifiutato, già speso o assente ferma ancora l'accesso prima di Supabase.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const cloudflare = vi.hoisted(() => {
  const emessi = new Set<string>();
  const usi = new Map<string, number>();
  return {
    emetti(gettone: string) {
      emessi.add(gettone);
    },
    usi(gettone: string) {
      return usi.get(gettone) ?? 0;
    },
    azzera() {
      emessi.clear();
      usi.clear();
    },
    /** Come siteverify: vero solo al primo uso di un gettone emesso. */
    verifica(gettone: string | null | undefined): { success: boolean; 'error-codes'?: string[] } {
      if (!gettone) return { success: false, 'error-codes': ['missing-input-response'] };
      const n = (usi.get(gettone) ?? 0) + 1;
      usi.set(gettone, n);
      if (!emessi.has(gettone)) return { success: false, 'error-codes': ['invalid-input-response'] };
      if (n > 1) return { success: false, 'error-codes': ['timeout-or-duplicate'] };
      return { success: true };
    },
  };
});

const supabase = vi.hoisted(() => ({
  captchaAcceso: false,
  chiamate: [] as Array<{ email: string; captchaToken?: string }>,
}));

vi.mock('@/lib/supabase/auth-server', () => ({
  authServer: {
    signIn: async (email: string, _password: string, options?: { captchaToken?: string }) => {
      supabase.chiamate.push({ email, captchaToken: options?.captchaToken });
      const client = { auth: { signOut: async () => ({ error: null }) } };
      if (supabase.captchaAcceso) {
        const esito = cloudflare.verifica(options?.captchaToken);
        if (!esito.success) {
          return {
            data: { user: null, session: null },
            error: {
              name: 'AuthApiError',
              status: 400,
              code: 'captcha_failed',
              message: `captcha protection: request disallowed (${esito['error-codes']?.[0] ?? ''})`,
            },
            client,
          };
        }
      }
      return {
        data: {
          user: { id: 'u1', email, email_confirmed_at: '2026-11-01T00:00:00Z', user_metadata: {} },
          session: null,
        },
        error: null,
        client,
      };
    },
  },
}));

import { POST } from '@/app/api/auth/signin/route';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
let chiamateSiteverify = 0;

const fetchFinto = (async (input: unknown, init?: { body?: unknown }) => {
  const url = String(input);
  if (url !== SITEVERIFY) throw new Error(`rete non prevista in questa prova: ${url}`);
  chiamateSiteverify += 1;
  const corpo = new URLSearchParams(String(init?.body ?? ''));
  return new Response(JSON.stringify(cloudflare.verifica(corpo.get('response'))), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as unknown as typeof fetch;

let contatore = 0;
function accedi(captchaToken?: string) {
  contatore += 1;
  return POST(
    new Request('http://localhost/api/auth/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.7.1.${contatore}` },
      body: JSON.stringify({ email: `r07-${contatore}@esempio.it`, password: 'giusta123', captchaToken }),
    }),
  );
}

describe('R07-001 — il gettone anti-robot dell’accesso si spende una volta sola', () => {
  beforeEach(() => {
    cloudflare.azzera();
    supabase.captchaAcceso = false;
    supabase.chiamate = [];
    chiamateSiteverify = 0;
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'segreto-finto');
    vi.stubEnv('CAPTCHA_SU_SUPABASE_ACCESO', '');
    vi.stubGlobal('fetch', fetchFinto);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(['1', 'true'])(
    'CAPTCHA di Supabase dichiarato acceso (%s): il server non chiama siteverify e l’accesso riesce',
    async (valore) => {
      vi.stubEnv('CAPTCHA_SU_SUPABASE_ACCESO', valore);
      supabase.captchaAcceso = true;
      cloudflare.emetti('g-acceso');

      const res = await accedi('g-acceso');

      expect(res.status).toBe(200);
      expect(chiamateSiteverify).toBe(0);
      expect(supabase.chiamate).toHaveLength(1);
      expect(supabase.chiamate[0].captchaToken).toBe('g-acceso');
      expect(cloudflare.usi('g-acceso')).toBe(1);
    },
  );

  it('acceso: il gettone che Supabase rifiuta si dice come CAPTCHA, non come password sbagliata', async () => {
    vi.stubEnv('CAPTCHA_SU_SUPABASE_ACCESO', '1');
    supabase.captchaAcceso = true;

    const res = await accedi('g-mai-emesso');

    expect(res.status).toBe(400);
    const corpo = await res.json();
    expect(corpo.error?.message).toBe('CAPTCHA non valido');
    expect(cloudflare.usi('g-mai-emesso')).toBe(1);
  });

  it('spento: verifica il server, una volta sola, e l’accesso riesce', async () => {
    cloudflare.emetti('g-spento');

    const res = await accedi('g-spento');

    expect(res.status).toBe(200);
    expect(chiamateSiteverify).toBe(1);
    expect(cloudflare.usi('g-spento')).toBe(1);
    expect(supabase.chiamate).toHaveLength(1);
  });

  it.each(['', '0', 'no'])('valore «%s»: resta spento, il server verifica ancora', async (valore) => {
    vi.stubEnv('CAPTCHA_SU_SUPABASE_ACCESO', valore);

    const res = await accedi('g-mai-emesso');

    expect(res.status).toBe(400);
    expect(chiamateSiteverify).toBe(1);
    expect(supabase.chiamate).toHaveLength(0);
  });

  it('spento: un gettone rifiutato da Cloudflare ferma l’accesso prima di Supabase', async () => {
    const res = await accedi('g-falso');

    expect(res.status).toBe(400);
    const corpo = await res.json();
    expect(corpo.error?.message).toBe('CAPTCHA non valido');
    expect(supabase.chiamate).toHaveLength(0);
  });

  it('spento: un gettone già speso ferma l’accesso prima di Supabase', async () => {
    cloudflare.emetti('g-speso');
    cloudflare.verifica('g-speso');

    const res = await accedi('g-speso');

    expect(res.status).toBe(400);
    expect(supabase.chiamate).toHaveLength(0);
  });

  it('spento: senza gettone l’accesso si ferma («CAPTCHA mancante»)', async () => {
    const res = await accedi(undefined);

    expect(res.status).toBe(400);
    const corpo = await res.json();
    expect(corpo.error?.message).toBe('CAPTCHA mancante');
    expect(chiamateSiteverify).toBe(0);
    expect(supabase.chiamate).toHaveLength(0);
  });
});

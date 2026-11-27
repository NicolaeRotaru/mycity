/**
 * R07-016 — La registrazione fatta dal server manda un link di conferma che fa entrare.
 *
 * `authServer.signUp` usava il client anonimo (supabase-js, flusso implicito): Supabase,
 * aprendo il link, rimanda a `emailRedirectTo` con la sessione nel frammento `#access_token=…`.
 * /auth/callback legge solo `?code=` (un server il frammento non lo vede): `senza-codice`, e
 * la persona resta fuori. Col flusso PKCE, come la pagina /sign-up, Supabase rimanda con
 * `?code=` e il verificatore resta nei cookie del browser che si è registrato.
 *
 * Supabase finto (fetch verso /auth/v1): l'iscrizione ricorda se è arrivata la sfida PKCE; il
 * link si costruisce come lo costruirebbe Supabase; il codice si scambia come fa
 * /auth/callback, con un client server che legge i cookie lasciati dalla registrazione.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';

const SUPABASE = 'https://progetto.supabase.co';

const stato = vi.hoisted(() => ({
  biscotti: new Map<string, string>(),
  iscrizioni: [] as Array<{ url: string; corpo: Record<string, unknown> }>,
  scambi: [] as Array<Record<string, unknown>>,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => (stato.biscotti.has(nome) ? { name: nome, value: stato.biscotti.get(nome)! } : undefined),
    getAll: () => [...stato.biscotti].map(([name, value]) => ({ name, value })),
    set: (c: { name: string; value: string }) => {
      if (c.value) stato.biscotti.set(c.name, c.value);
      else stato.biscotti.delete(c.name);
    },
  }),
}));
vi.mock('@/lib/env', () => ({
  requireSupabasePublic: () => ({ url: 'https://progetto.supabase.co', key: 'chiave-anonima' }),
  requireSupabaseService: () => ({ url: 'https://progetto.supabase.co', key: 'chiave-di-servizio' }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { authServer } from '@/lib/supabase/auth-server';

const UTENTE = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'giulia@esempio.it',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-11-27T10:00:00Z',
};

function risposta(stato: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status: stato, headers: { 'content-type': 'application/json' } });
}

function sfidaDi(verificatore: string, metodo: unknown): string {
  return metodo === 'plain' ? verificatore : createHash('sha256').update(verificatore).digest('base64url');
}

/** Il link che Supabase manda per email, come lo segue il browser dopo /auth/v1/verify. */
function linkDopoLaConferma(): URL {
  const { url, corpo } = stato.iscrizioni[0];
  const ritorno = new URL(url).searchParams.get('redirect_to')!;
  if (corpo.code_challenge) return new URL(`${ritorno}?code=codice-del-link`);
  return new URL(`${ritorno}#access_token=gettone&refresh_token=rinnovo&type=signup`);
}

beforeEach(() => {
  stato.biscotti.clear();
  stato.iscrizioni.length = 0;
  stato.scambi.length = 0;
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const corpo = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.startsWith(`${SUPABASE}/auth/v1/signup`)) {
      stato.iscrizioni.push({ url, corpo });
      // Conferma dell'email accesa: niente sessione, solo l'utente da confermare.
      return risposta(200, { ...UTENTE, confirmation_sent_at: '2026-11-27T10:00:00Z' });
    }
    if (url.startsWith(`${SUPABASE}/auth/v1/token?grant_type=pkce`)) {
      stato.scambi.push(corpo);
      const iscrizione = stato.iscrizioni[0]?.corpo ?? {};
      const verificatore = typeof corpo.code_verifier === 'string' ? corpo.code_verifier : '';
      const giusto =
        corpo.auth_code === 'codice-del-link' &&
        !!verificatore &&
        sfidaDi(verificatore, iscrizione.code_challenge_method) === iscrizione.code_challenge;
      if (!giusto) return risposta(400, { code: 400, error_code: 'bad_code_verifier', msg: 'code challenge does not match previously saved code verifier' });
      return risposta(200, {
        access_token: 'gettone-di-accesso',
        refresh_token: 'gettone-di-rinnovo',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { ...UTENTE, email_confirmed_at: '2026-11-27T10:05:00Z' },
      });
    }
    return risposta(404, { msg: `inatteso: ${url}` });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('R07-016 — il link di conferma della registrazione dal server fa entrare', () => {
  it('IL CASO DELLA VOCE — il link torna a /auth/callback con ?code=, e il codice si scambia coi cookie del browser', async () => {
    const { error } = await authServer.signUp('giulia@esempio.it', 'una-password-lunga', {
      captchaToken: 'gettone-1',
      emailRedirectTo: 'https://mycity.test/auth/callback',
      data: { role: 'buyer' },
    });
    expect(error).toBeNull();
    expect(stato.iscrizioni).toHaveLength(1);

    const link = linkDopoLaConferma();
    expect(link.pathname).toBe('/auth/callback');
    const codice = link.searchParams.get('code');
    expect(codice, 'il link porta la sessione nel frammento #: /auth/callback non la vede (senza-codice)').toBeTruthy();

    // Come app/auth/callback/route.ts: un client server che legge i cookie della richiesta.
    const callback = createServerClient(SUPABASE, 'chiave-anonima', {
      cookies: {
        get: (nome: string) => stato.biscotti.get(nome),
        set: () => {},
        remove: () => {},
      },
    });
    const { data, error: erroreScambio } = await callback.auth.exchangeCodeForSession(codice!);
    expect(erroreScambio, 'il verificatore non è nei cookie del browser che si è registrato').toBeNull();
    expect(data.session?.access_token).toBe('gettone-di-accesso');
  });

  it('il gettone anti-robot, il ritorno e i dati dell’iscrizione arrivano ancora a Supabase', async () => {
    await authServer.signUp('giulia@esempio.it', 'una-password-lunga', {
      captchaToken: 'gettone-1',
      emailRedirectTo: 'https://mycity.test/auth/callback',
      data: { role: 'seller', full_name: 'Giulia' },
    });
    const { url, corpo } = stato.iscrizioni[0];
    expect(new URL(url).searchParams.get('redirect_to')).toBe('https://mycity.test/auth/callback');
    expect(corpo.gotrue_meta_security).toEqual({ captcha_token: 'gettone-1' });
    expect(corpo.data).toEqual({ role: 'seller', full_name: 'Giulia' });
  });
});

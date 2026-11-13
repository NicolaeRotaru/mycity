/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 13/11/2026 (R24-020) — LA REGISTRAZIONE NON PASSAVA DAL SERVER.
 *
 * La pagina /sign-up chiamava `supabase.auth.signUp` dal browser, con la chiave
 * pubblica: il freno sulle iscrizioni (5 l'ora per rete) e la verifica del
 * gettone anti-robot vivevano in una rotta che nessuno chiamava. Chiunque
 * poteva creare account a raffica.
 *
 * ① La pagina vera, montata: chi si iscrive passa dalla rotta del server, con
 *   ruolo, nome, consenso e ritorno; dal browser `signUp` non parte più.
 * ② La rotta: il freno scatta alla sesta iscrizione dalla stessa rete, il
 *   gettone si verifica prima di chiamare Supabase, e ruolo, nome e versione
 *   dei testi arrivano a Supabase come li metteva la pagina.
 * ③ Il gettone lo verifica UNO solo (giro di correzione): Cloudflare lo dà valido
 *   una volta. Qui il Cloudflare finto è uno solo, condiviso fra siteverify e il
 *   Supabase finto: un gettone speso da uno non passa dall'altro. Con
 *   CAPTCHA_SU_SUPABASE spenta verifica la rotta e il gettone non va a Supabase;
 *   accesa, verifica Supabase e la rotta non chiama siteverify.
 */

const signUpServer = vi.fn();
vi.mock('@/lib/supabase/auth-server', () => ({
  authServer: { signUp: (...a: unknown[]) => signUpServer(...a), signIn: vi.fn() },
}));
// La chiave segreta è finta: le risposte di siteverify le dà il Cloudflare finto qui sotto.
vi.mock('@/lib/env', () => ({
  env: { appUrl: () => 'https://mycity.test', turnstileSecretKey: () => 'segreto-finto-di-prova' },
}));

/** Il Cloudflare finto: ogni gettone vale una volta sola, per siteverify e per Supabase insieme. */
const cloudflare = { emessi: new Set<string>(), spesi: new Set<string>(), siteverify: [] as string[] };
function nuovoGettone(): string {
  const t = `gettone-${cloudflare.emessi.size + 1}`;
  cloudflare.emessi.add(t);
  return t;
}
function spendi(gettone: unknown): boolean {
  if (typeof gettone !== 'string' || !cloudflare.emessi.has(gettone) || cloudflare.spesi.has(gettone)) return false;
  cloudflare.spesi.add(gettone);
  return true;
}
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
function accendiCloudflare() {
  vi.stubGlobal('fetch', async (dove: unknown, opzioni?: { body?: string }) => {
    if (String(dove) !== SITEVERIFY) throw new Error(`chiamata di rete inattesa: ${String(dove)}`);
    const gettone = new URLSearchParams(opzioni?.body ?? '').get('response') ?? '';
    cloudflare.siteverify.push(gettone);
    const buono = spendi(gettone);
    return {
      ok: true,
      status: 200,
      json: async () => (buono ? { success: true } : { success: false, 'error-codes': ['timeout-or-duplicate'] }),
    };
  });
}
/** Il Supabase finto: col CAPTCHA acceso verifica il gettone con lo stesso Cloudflare. */
let captchaAccesoSuSupabase = false;
async function supabaseFinto(_email: unknown, _password: unknown, opzioni?: { captchaToken?: string }) {
  if (captchaAccesoSuSupabase && !spendi(opzioni?.captchaToken)) {
    return {
      data: { user: null, session: null },
      error: { status: 400, code: 'captcha_failed', message: 'captcha protection: request disallowed (timeout-or-duplicate)' },
    };
  }
  return { data: { user: { id: 'u1' }, session: null }, error: null };
}

type Pagina = ComponentType<Record<string, unknown>>;
type G = Record<string, unknown> & {
  __QUERY_FINTA__?: string;
  __AUTH_FINTA__?: Record<string, (...a: unknown[]) => unknown>;
  __NAVIGAZIONI__?: Array<{ tipo: string; dove: string }>;
};
const g = globalThis as unknown as G;

let Registrazione: Pagina;
beforeAll(async () => {
  Registrazione = (await monta('app/sign-up/page.tsx')).default as Pagina;
}, 120000);

const montate: Array<{ smonta: () => void }> = [];
function apri(percorso: string) {
  const [path, query = ''] = percorso.split('?');
  window.history.replaceState(null, '', percorso);
  g.__QUERY_FINTA__ = query;
  (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = path;
  const s = accendi(Registrazione);
  montate.push(s);
  return s;
}
async function aspettaChe(vero: () => boolean, ms = 3000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (vero()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}
function scrivi(campo: HTMLInputElement, valore: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  void act(() => {
    setter.call(campo, valore);
    campo.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  g.__NAVIGAZIONI__ = [];
  g.__AUTH_FINTA__ = {};
  signUpServer.mockReset();
});
afterEach(() => {
  while (montate.length) montate.pop()!.smonta();
  delete g.__QUERY_FINTA__;
  delete g.__AUTH_FINTA__;
  delete g.__NAVIGAZIONI__;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function compilaEManda(s: ReturnType<typeof apri>) {
  scrivi(s.radice.querySelector<HTMLInputElement>('#signup-name')!, 'Anna Bianchi');
  scrivi(s.radice.querySelector<HTMLInputElement>('#signup-email')!, 'anna@esempio.it');
  scrivi(s.radice.querySelector<HTMLInputElement>('#signup-password')!, 'una-password-lunga');
  s.agisci(() => s.radice.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  void act(() => {
    s.radice.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('① la pagina di iscrizione passa dal server', () => {
  it('IL CASO CHE ROMPEVA — il modulo chiama la rotta, non Supabase dal browser', async () => {
    const dalBrowser: unknown[] = [];
    g.__AUTH_FINTA__ = {
      signUp: (dati) => {
        dalBrowser.push(dati);
        return { data: { user: { id: 'x' }, session: null }, error: null };
      },
    };
    const allaRotta: Array<{ dove: string; corpo: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (dove: unknown, opzioni?: { body?: string }) => {
      allaRotta.push({ dove: String(dove), corpo: JSON.parse(opzioni?.body ?? '{}') });
      return { ok: true, status: 201, json: async () => ({ ok: true, session: null }) };
    });

    const s = apri('/sign-up?role=seller&returnTo=/seller/dashboard');
    await aspettaChe(() => !!s.radice.querySelector('#signup-email'));
    scrivi(s.radice.querySelector<HTMLInputElement>('#signup-name')!, 'Anna Bianchi');
    scrivi(s.radice.querySelector<HTMLInputElement>('#signup-email')!, 'anna@esempio.it');
    scrivi(s.radice.querySelector<HTMLInputElement>('#signup-password')!, 'una-password-lunga');
    s.agisci(() => s.radice.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    void act(() => {
      s.radice.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await aspettaChe(() => (g.__NAVIGAZIONI__ ?? []).length > 0 || dalBrowser.length > 0);

    expect(dalBrowser, 'la pagina chiama ancora supabase.auth.signUp dal browser: freno e anti-robot non vedono nessuno').toHaveLength(0);
    expect(allaRotta.map((c) => c.dove)).toEqual(['/api/auth/registrazione']);
    expect(allaRotta[0].corpo).toMatchObject({
      email: 'anna@esempio.it',
      password: 'una-password-lunga',
      role: 'seller',
      fullName: 'Anna Bianchi',
      accettaTermini: true,
      returnTo: '/seller/dashboard',
    });
    expect(g.__NAVIGAZIONI__).toContainEqual({
      tipo: 'push',
      dove: '/auth/verify-email?returnTo=%2Fseller%2Fdashboard&da=registrazione',
    });
  }, 30000);

  it('la sessione che arriva dal server non si installa: la pagina lo dice e non manda avanti', async () => {
    const installate: unknown[] = [];
    g.__AUTH_FINTA__ = {
      setSession: (gettoni) => {
        installate.push(gettoni);
        return { data: { session: null }, error: { status: 400, message: 'Invalid Refresh Token: Refresh Token Not Found' } };
      },
    };
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, session: { access_token: 'accesso-finto', refresh_token: 'rinnovo-finto' } }),
    }));

    const s = apri('/sign-up');
    await aspettaChe(() => !!s.radice.querySelector('#signup-email'));
    compilaEManda(s);
    await aspettaChe(() => !!s.radice.querySelector('[role="alert"]') || (g.__NAVIGAZIONI__ ?? []).length > 0);

    expect(installate).toEqual([{ access_token: 'accesso-finto', refresh_token: 'rinnovo-finto' }]);
    expect(g.__NAVIGAZIONI__, 'la sessione non si è installata ma la pagina è andata avanti come se niente fosse').toEqual([]);
    expect(s.radice.querySelector('[role="alert"]')?.textContent ?? '').not.toBe('');
  }, 30000);
});

describe('② la rotta /api/auth/registrazione', () => {
  const chiede = (corpo: Record<string, unknown>, ip = '203.0.113.7') =>
    new Request('https://mycity.test/api/auth/registrazione', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(corpo),
    });
  const valido = () => ({
    email: 'anna@esempio.it',
    password: 'una-password-lunga',
    accettaTermini: true,
    captchaToken: nuovoGettone(),
  });

  beforeEach(async () => {
    const { __resetRateLimitBuckets } = await import('@/lib/rate-limit');
    __resetRateLimitBuckets();
    cloudflare.emessi.clear();
    cloudflare.spesi.clear();
    cloudflare.siteverify.length = 0;
    captchaAccesoSuSupabase = false;
    vi.stubEnv('CAPTCHA_SU_SUPABASE', '');
    accendiCloudflare();
    signUpServer.mockImplementation(supabaseFinto);
  });

  it('porta a Supabase ruolo, nome, versione dei testi e il ritorno dopo la conferma', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    const { VERSIONE_TESTI_LEGALI } = await import('@/lib/legal/versione');
    const r = await POST(chiede({ ...valido(), role: 'rider', fullName: '  Anna Bianchi ', returnTo: '/checkout' }));
    expect(r.status).toBe(201);
    expect(signUpServer).toHaveBeenCalledTimes(1);
    const [email, password, opzioni] = signUpServer.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(email).toBe('anna@esempio.it');
    expect(password).toBe('una-password-lunga');
    expect(opzioni.data).toEqual({ role: 'rider', full_name: 'Anna Bianchi', versione_testi_accettati: VERSIONE_TESTI_LEGALI });
    const ritorno = new URL(String(opzioni.emailRedirectTo));
    expect(ritorno.origin + ritorno.pathname).toBe('https://mycity.test/auth/callback');
    expect(ritorno.searchParams.get('next')).toMatch(/^\/checkout\?/);
  });

  it('un ruolo inventato («admin») diventa acquirente', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    await POST(chiede({ ...valido(), role: 'admin' }));
    const opzioni = signUpServer.mock.calls[0][2] as { data: { role: string } };
    expect(opzioni.data.role).toBe('buyer');
  });

  it('senza la spunta dei Termini non nasce nessun account', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    const r = await POST(chiede({ ...valido(), accettaTermini: false }));
    expect(r.status).toBe(400);
    expect(signUpServer).not.toHaveBeenCalled();
  });

  it('il freno: alla sesta iscrizione dalla stessa rete risponde 429', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    for (let i = 0; i < 5; i++) {
      const r = await POST(chiede({ ...valido(), email: `anna${i}@esempio.it` }, '198.51.100.9'));
      expect(r.status).toBe(201);
    }
    const sesta = await POST(chiede({ ...valido(), email: 'anna6@esempio.it' }, '198.51.100.9'));
    expect(sesta.status).toBe(429);
    expect(sesta.headers.get('Retry-After')).toBeTruthy();
    expect(signUpServer).toHaveBeenCalledTimes(5);
  });

  it('il freno conta sulla chiave signup:<rete>, la stessa della rotta vecchia: i due tetti non si sommano', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    const { rateLimitAsync } = await import('@/lib/rate-limit');
    // Cinque iscrizioni già passate dall'altra porta, dalla stessa rete.
    for (let i = 0; i < 5; i++) await rateLimitAsync({ key: 'signup:198.51.100.20', max: 5, windowMs: 60 * 60_000 });
    const daQui = await POST(chiede(valido(), '198.51.100.20'));
    expect(daQui.status, 'il freno non usa la chiave signup:<rete>').toBe(429);
    const altraRete = await POST(chiede(valido(), '198.51.100.21'));
    expect(altraRete.status, 'il freno conta tutte le reti insieme').toBe(201);
    expect(signUpServer).toHaveBeenCalledTimes(1);
  });

  it('l’errore di Supabase torna col suo codice e il suo stato, perché la pagina lo traduca', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    signUpServer.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { status: 422, code: 'weak_password', message: 'Password is known to be weak and easy to guess, please choose a different one.' },
    });
    const r = await POST(chiede(valido()));
    expect(r.status).toBe(422);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ ok: false, error: { code: 'weak_password' } });
  });

  it('Supabase che non risponde (stato 0, «fetch failed») è un 503 del servizio, non un 400 sulla rete del cliente', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    signUpServer.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' },
    });
    const r = await POST(chiede(valido()));
    expect(r.status).toBe(503);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(corpo.error.message).not.toMatch(/fetch|rete|connessione/i);
  });
});

describe.each([
  { stato: 'spenta', valore: '', suSupabase: false },
  { stato: 'accesa', valore: '1', suSupabase: true },
])('③ un gettone, una verifica sola — CAPTCHA_SU_SUPABASE $stato', ({ valore, suSupabase }) => {
  const chiede = (corpo: Record<string, unknown>, ip = '203.0.113.7') =>
    new Request('https://mycity.test/api/auth/registrazione', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(corpo),
    });
  const iscrizione = (captchaToken: string, email = 'anna@esempio.it') => ({
    email,
    password: 'una-password-lunga',
    accettaTermini: true,
    captchaToken,
  });

  beforeEach(async () => {
    const { __resetRateLimitBuckets } = await import('@/lib/rate-limit');
    __resetRateLimitBuckets();
    cloudflare.emessi.clear();
    cloudflare.spesi.clear();
    cloudflare.siteverify.length = 0;
    // Supabase è impostato come dice la variabile: è la regola che va seguita su Vercel e su Supabase.
    captchaAccesoSuSupabase = suSupabase;
    vi.stubEnv('CAPTCHA_SU_SUPABASE', valore);
    // La chiave pubblica di prova di Cloudflare: senza, lib/captcha scrive un errore a ogni gettone mancante.
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '1x00000000000000000000AA');
    accendiCloudflare();
    signUpServer.mockImplementation(supabaseFinto);
  });

  it('IL CASO CHE ROMPEVA — un gettone nuovo fa nascere l’account, e lo verifica uno solo', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    const gettone = nuovoGettone();
    const r = await POST(chiede(iscrizione(gettone)));
    expect(r.status, 'il gettone è stato speso due volte (siteverify e Supabase): captcha_failed').toBe(201);
    expect(signUpServer).toHaveBeenCalledTimes(1);
    const opzioni = signUpServer.mock.calls[0][2] as { captchaToken?: string };
    if (suSupabase) {
      expect(cloudflare.siteverify, 'col CAPTCHA su Supabase la rotta non deve chiamare siteverify').toEqual([]);
      expect(opzioni.captchaToken).toBe(gettone);
    } else {
      expect(cloudflare.siteverify).toEqual([gettone]);
      expect(opzioni.captchaToken, 'il gettone già speso da siteverify è andato anche a Supabase').toBeUndefined();
    }
  });

  it('cinque iscrizioni con cinque gettoni nuovi passano tutte: nessun posto del freno bruciato', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    for (let i = 0; i < 5; i++) {
      const r = await POST(chiede(iscrizione(nuovoGettone(), `anna${i}@esempio.it`), '198.51.100.30'));
      expect(r.status).toBe(201);
    }
  });

  it('un gettone già speso non fa nascere niente', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    const gettone = nuovoGettone();
    expect((await POST(chiede(iscrizione(gettone)))).status).toBe(201);
    const ancora = await POST(chiede(iscrizione(gettone, 'bruno@esempio.it')));
    expect(ancora.status).toBe(400);
    if (suSupabase) {
      expect((await ancora.json()).error.code).toBe('captcha_failed');
    } else {
      // Rifiutato da siteverify: Supabase non viene neanche chiamato la seconda volta.
      expect(signUpServer).toHaveBeenCalledTimes(1);
    }
  });

  it('senza gettone Supabase non viene chiamato', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    const r = await POST(chiede(iscrizione('')));
    expect(r.status).toBe(400);
    expect(signUpServer).not.toHaveBeenCalled();
  });
});

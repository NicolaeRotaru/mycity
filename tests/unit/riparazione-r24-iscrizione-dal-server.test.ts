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
 */

const signUpServer = vi.fn();
const verificaGettone = vi.fn();
vi.mock('@/lib/supabase/auth-server', () => ({
  authServer: { signUp: (...a: unknown[]) => signUpServer(...a), signIn: vi.fn() },
}));
vi.mock('@/lib/captcha', () => ({ verifyTurnstileToken: (...a: unknown[]) => verificaGettone(...a) }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://mycity.test' } }));

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
  verificaGettone.mockReset();
});
afterEach(() => {
  while (montate.length) montate.pop()!.smonta();
  delete g.__QUERY_FINTA__;
  delete g.__AUTH_FINTA__;
  delete g.__NAVIGAZIONI__;
  vi.unstubAllGlobals();
});

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
});

describe('② la rotta /api/auth/registrazione', () => {
  const chiede = (corpo: Record<string, unknown>, ip = '203.0.113.7') =>
    new Request('https://mycity.test/api/auth/registrazione', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(corpo),
    });
  const valido = { email: 'anna@esempio.it', password: 'una-password-lunga', accettaTermini: true, captchaToken: 'gettone' };

  beforeEach(async () => {
    const { __resetRateLimitBuckets } = await import('@/lib/rate-limit');
    __resetRateLimitBuckets();
    verificaGettone.mockResolvedValue({ ok: true });
    signUpServer.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
  });

  it('porta a Supabase ruolo, nome, versione dei testi e il ritorno dopo la conferma', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    const { VERSIONE_TESTI_LEGALI } = await import('@/lib/legal/versione');
    const r = await POST(chiede({ ...valido, role: 'rider', fullName: '  Anna Bianchi ', returnTo: '/checkout' }));
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
    await POST(chiede({ ...valido, role: 'admin' }));
    const opzioni = signUpServer.mock.calls[0][2] as { data: { role: string } };
    expect(opzioni.data.role).toBe('buyer');
  });

  it('il gettone anti-robot si verifica sul server: se non va, Supabase non viene chiamato', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    verificaGettone.mockResolvedValueOnce({ ok: false, reason: 'CAPTCHA non valido' });
    const r = await POST(chiede(valido));
    expect(r.status).toBe(400);
    expect(verificaGettone).toHaveBeenCalledWith('gettone', '203.0.113.7');
    expect(signUpServer).not.toHaveBeenCalled();
  });

  it('senza la spunta dei Termini non nasce nessun account', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    const r = await POST(chiede({ ...valido, accettaTermini: false }));
    expect(r.status).toBe(400);
    expect(signUpServer).not.toHaveBeenCalled();
  });

  it('il freno: alla sesta iscrizione dalla stessa rete risponde 429', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    for (let i = 0; i < 5; i++) {
      const r = await POST(chiede({ ...valido, email: `anna${i}@esempio.it` }, '198.51.100.9'));
      expect(r.status).toBe(201);
    }
    const sesta = await POST(chiede({ ...valido, email: 'anna6@esempio.it' }, '198.51.100.9'));
    expect(sesta.status).toBe(429);
    expect(sesta.headers.get('Retry-After')).toBeTruthy();
    expect(signUpServer).toHaveBeenCalledTimes(5);
  });

  it('l’errore di Supabase torna col suo codice e il suo stato, perché la pagina lo traduca', async () => {
    const { POST } = await import('@/app/api/auth/registrazione/route');
    signUpServer.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { status: 422, code: 'weak_password', message: 'Password is known to be weak and easy to guess, please choose a different one.' },
    });
    const r = await POST(chiede(valido));
    expect(r.status).toBe(422);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ ok: false, error: { code: 'weak_password' } });
  });
});

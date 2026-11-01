// @vitest-environment jsdom
/**
 * LA PASSWORD SI CAMBIA SOLO COL LINK DI RECUPERO.
 *
 * La pagina della nuova password monta per davvero (client Supabase finto):
 *  ① link di recupero aperto qui (evento PASSWORD_RECOVERY) → si sceglie la password;
 *  ② link passato da /auth/confirm (sessione nei cookie, il gettone porta il
 *     metodo `recovery`) → si sceglie la password;
 *  ③ una sessione qualunque (SIGNED_IN normale) → `updateUser` non parte;
 *  ④ la conferma dell'iscrizione dalla mail porta la persona dentro da sola,
 *     non sulla pagina della password.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { destinazioneDopoLaConferma, leggiLinkDiConferma, PAGINA_NUOVA_PASSWORD } from '@/lib/auth/link-email';

type Pagina = ComponentType<Record<string, unknown>>;
type G = Record<string, unknown> & {
  __QUERY_FINTA__?: string;
  __UTENTE__?: unknown;
  __GETTONE__?: string;
  __AUTH_FINTA__?: Record<string, (...a: unknown[]) => unknown>;
  __ASCOLTI_AUTH__?: Array<(evento: string, sessione: unknown) => void>;
  __NAVIGAZIONI__?: unknown[];
};
const g = globalThis as unknown as G;

let NuovaPassword: Pagina;
beforeAll(async () => {
  NuovaPassword = (await monta('app/reset-password/page.tsx')).default as Pagina;
}, 120000);

const montate: Array<{ smonta: () => void }> = [];
let chiamateUpdate: unknown[] = [];

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function gettone(metodo: string, secondiFa = 30): string {
  const ora = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'u1', amr: [{ method: metodo, timestamp: ora - secondiFa }] })}.firma`;
}

function apri() {
  window.history.replaceState(null, '', '/reset-password');
  g.__QUERY_FINTA__ = '';
  (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = '/reset-password';
  const s = accendi(NuovaPassword);
  montate.push(s);
  return s;
}

async function aspettaChe(vero: () => boolean, ms = 3000): Promise<void> {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (vero()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

function moduloPassword(radice: HTMLElement): HTMLFormElement | null {
  return ([...radice.querySelectorAll('form')].find((f) => !f.querySelector('#reset-request-email')) ?? null) as HTMLFormElement | null;
}

function scrivi(campo: HTMLInputElement, valore: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  void act(() => {
    setter.call(campo, valore);
    campo.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

/** Prova a mettere una password nuova come farebbe una persona. */
async function provaACambiare(radice: HTMLElement) {
  const modulo = moduloPassword(radice);
  if (!modulo) return;
  const campi = [...modulo.querySelectorAll('input')] as HTMLInputElement[];
  for (const c of campi) scrivi(c, 'NuovaPassword-2026!');
  await act(async () => {
    modulo.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 50));
  });
}

beforeEach(() => {
  chiamateUpdate = [];
  g.__NAVIGAZIONI__ = [];
  g.__ASCOLTI_AUTH__ = [];
  g.__AUTH_FINTA__ = {
    updateUser: (...a: unknown[]) => {
      chiamateUpdate.push(a);
      return { data: { user: { id: 'u1' } }, error: null };
    },
  };
  g.__UTENTE__ = { id: 'u1', email: 'maria@example.com' };
});

afterEach(() => {
  while (montate.length) montate.pop()!.smonta();
  delete g.__QUERY_FINTA__;
  delete g.__AUTH_FINTA__;
  delete g.__UTENTE__;
  delete g.__GETTONE__;
  delete g.__ASCOLTI_AUTH__;
  delete g.__NAVIGAZIONI__;
});

describe('la password si cambia solo col link di recupero', () => {
  it('③ una sessione qualunque già aperta: niente modulo e updateUser non parte', async () => {
    g.__GETTONE__ = gettone('password');
    const s = apri();
    await act(async () => {
      for (const a of g.__ASCOLTI_AUTH__ ?? []) a('SIGNED_IN', { user: g.__UTENTE__, access_token: g.__GETTONE__ });
    });
    await aspettaChe(() => !!s.radice.querySelector('#reset-request-email') || !!moduloPassword(s.radice), 4000);
    await provaACambiare(s.radice);
    expect(chiamateUpdate, 'con un account già aperto si mette una password nuova senza il link').toHaveLength(0);
    expect(moduloPassword(s.radice)).toBeNull();
    expect(s.radice.querySelector('#reset-request-email')).not.toBeNull();
  }, 30000);

  it('① link di recupero aperto qui (PASSWORD_RECOVERY): si sceglie la password', async () => {
    g.__GETTONE__ = gettone('recovery');
    const s = apri();
    await act(async () => {
      for (const a of g.__ASCOLTI_AUTH__ ?? []) a('PASSWORD_RECOVERY', { user: g.__UTENTE__, access_token: g.__GETTONE__ });
    });
    await aspettaChe(() => !!moduloPassword(s.radice), 4000);
    await provaACambiare(s.radice);
    expect(chiamateUpdate).toHaveLength(1);
  }, 30000);

  it('② link passato da /auth/confirm: la sessione nei cookie porta il recupero e si sceglie la password', async () => {
    const link = leggiLinkDiConferma(new URLSearchParams('token_hash=abcdef0123456789&type=recovery'));
    expect(link.valido).toBe(true);
    if (link.valido) expect(destinazioneDopoLaConferma('https://mycity.test', link).pathname).toBe(PAGINA_NUOVA_PASSWORD);
    g.__GETTONE__ = gettone('recovery');
    const s = apri();
    await aspettaChe(() => !!moduloPassword(s.radice), 4000);
    await provaACambiare(s.radice);
    expect(chiamateUpdate).toHaveLength(1);
  }, 30000);

  it('un recupero di ore fa non vale più', async () => {
    g.__GETTONE__ = gettone('recovery', 3 * 60 * 60);
    const s = apri();
    await aspettaChe(() => !!s.radice.querySelector('#reset-request-email') || !!moduloPassword(s.radice), 4000);
    await provaACambiare(s.radice);
    expect(chiamateUpdate).toHaveLength(0);
  }, 30000);

  it('④ la conferma dell’iscrizione dalla mail riporta dentro da sola, non sulla pagina della password', () => {
    const link = leggiLinkDiConferma(new URLSearchParams('token_hash=abcdef0123456789&type=signup&next=/checkout'));
    expect(link.valido).toBe(true);
    if (!link.valido) return;
    const dove = destinazioneDopoLaConferma('https://mycity.test', link);
    expect(dove.pathname).toBe('/checkout');
    expect(dove.searchParams.get('auth')).toBe('signup');
  });
});

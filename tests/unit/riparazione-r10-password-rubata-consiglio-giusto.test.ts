// @vitest-environment jsdom
/**
 * R10-016 — Sulla pagina della nuova password, una password già finita negli
 * elenchi di password rubate veniva rifiutata con «Password troppo debole. Usane
 * una più lunga, con maiuscole/numeri/simboli»: un consiglio sbagliato (era già
 * lunga e complicata), e in un avviso che spariva dopo pochi secondi.
 *
 *  ① la pagina VERA (client Supabase finto) con il rifiuto «pwned»: il motivo
 *    giusto resta scritto nella pagina, sotto il campo;
 *  ② la traduzione legge il motivo, non solo la parola «weak».
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import {
  traduciErroreNuovaPassword, PASSWORD_RUBATA, PASSWORD_CORTA, PASSWORD_SEMPLICE,
} from '@/lib/auth/errori-nuova-password';

type Pagina = ComponentType<Record<string, unknown>>;
const g = globalThis as unknown as Record<string, any>;

let NuovaPassword: Pagina;
beforeAll(async () => {
  NuovaPassword = (await monta('app/reset-password/page.tsx')).default as Pagina;
}, 120000);

const montate: Array<{ smonta: () => void }> = [];
const RIFIUTO_PWNED = {
  message: 'Password is known to be weak and easy to guess, please choose a different one.',
  code: 'weak_password',
  reasons: ['pwned'],
};

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function gettoneDiRecupero(): string {
  const ora = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'u1', amr: [{ method: 'recovery', timestamp: ora - 30 }] })}.firma`;
}
async function aspettaChe(vero: () => boolean, ms = 4000): Promise<void> {
  const fine = Date.now() + ms;
  while (Date.now() < fine && !vero()) {
    await act(async () => { await new Promise((r) => setTimeout(r, 15)); });
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
  g.__ASCOLTI_AUTH__ = [];
  g.__NAVIGAZIONI__ = [];
  g.__UTENTE__ = { id: 'u1', email: 'maria@example.com' };
  g.__AUTH_FINTA__ = { updateUser: () => ({ data: { user: null }, error: RIFIUTO_PWNED }) };
});
afterEach(() => {
  while (montate.length) montate.pop()!.smonta();
  for (const k of ['__QUERY_FINTA__', '__AUTH_FINTA__', '__UTENTE__', '__GETTONE__', '__ASCOLTI_AUTH__', '__NAVIGAZIONI__']) delete g[k];
});

describe('R10-016 — una password rubata riceve il consiglio giusto, e resta scritto', () => {
  it('① il rifiuto «pwned» resta sotto il campo con il motivo vero', async () => {
    window.history.replaceState(null, '', '/reset-password');
    g.__QUERY_FINTA__ = '';
    g.__PERCORSO_FINTO__ = '/reset-password';
    g.__GETTONE__ = gettoneDiRecupero();
    const s = accendi(NuovaPassword);
    montate.push(s);
    await act(async () => {
      for (const a of g.__ASCOLTI_AUTH__ ?? []) a('PASSWORD_RECOVERY', { user: g.__UTENTE__, access_token: g.__GETTONE__ });
    });
    const modulo = () => [...s.radice.querySelectorAll('form')].find((f) => !f.querySelector('#reset-request-email')) as HTMLFormElement | undefined;
    await aspettaChe(() => !!modulo());
    for (const c of [...modulo()!.querySelectorAll('input')] as HTMLInputElement[]) scrivi(c, 'Estate-Piacenza-2019!');
    await act(async () => {
      modulo()!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 50));
    });
    await aspettaChe(() => (s.radice.textContent ?? '').includes('elenchi di password rubate'));
    // Passano i secondi in cui un avviso sparirebbe: il motivo resta nella pagina.
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    const t = s.radice.textContent ?? '';
    expect(t, 'il motivo vero (password rubata) non è scritto nella pagina').toContain(PASSWORD_RUBATA);
    expect(t).not.toMatch(/Usane una più lunga/);
  }, 60000);

  it('② la traduzione legge il motivo del rifiuto', () => {
    expect(traduciErroreNuovaPassword(RIFIUTO_PWNED)).toBe(PASSWORD_RUBATA);
    expect(traduciErroreNuovaPassword({ message: 'Password should be at least 8 characters.', reasons: ['length'] })).toBe(PASSWORD_CORTA);
    expect(
      traduciErroreNuovaPassword({ message: 'Password should contain at least one character of each: abc, ABC, 123', reasons: ['characters'] }),
    ).toBe(PASSWORD_SEMPLICE);
    expect(traduciErroreNuovaPassword({ message: 'New password should be different from the old password.' })).toMatch(/diversa/);
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { friendlyError, traduciErroreAuth } from '@/lib/errors';
import { PASSWORD_RUBATA, traduciErroreNuovaPassword } from '@/lib/auth/errori-nuova-password';

/**
 * 13/11/2026 (R24-008) — LA PASSWORD TROPPO COMUNE SI SPIEGAVA IN INGLESE.
 *
 * In palestra: /sign-up con «Password123!» o «qwerty123». Supabase risponde 422,
 * code `weak_password`, reasons [pwned], e sotto il campo compariva «Password is
 * known to be weak and easy to guess, please choose a different one.».
 * friendlyError non conosceva il codice e traduciErroreAuth non riconosceva la
 * frase. /reset-password invece la traduceva già, con un traduttore suo: qui la
 * frase è la stessa sulle due pagine.
 */

const PWNED = 'Password is known to be weak and easy to guess, please choose a different one.';
const SEMPLICE = 'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789';
// Supabase mette in fila i motivi: corta E rubata insieme.
const CORTA_E_RUBATA = `Password should be at least 12 characters. ${PWNED}`;

describe('la password debole si spiega in italiano', () => {
  it('traduciErroreAuth riconosce la password comune, con la frase di /reset-password', () => {
    const qui = traduciErroreAuth(PWNED);
    expect(qui).not.toBeNull();
    expect(qui).toBe(traduciErroreNuovaPassword({ message: PWNED, code: 'weak_password', reasons: ['pwned'] }));
  });

  it('la sola lunghezza si dice come su /reset-password, con lo stesso N (R24-008)', () => {
    for (const n of [8, 12]) {
      const testo = `Password should be at least ${n} characters.`;
      const qui = traduciErroreAuth(testo);
      expect(qui).toBe(`La password è troppo corta: usane una di almeno ${n} caratteri.`);
      expect(qui).toBe(traduciErroreNuovaPassword({ message: testo, code: 'weak_password', reasons: ['length'] }));
    }
  });

  it('friendlyError col codice weak_password non lascia passare l’inglese', () => {
    const msg = friendlyError({ code: 'weak_password', status: 422, message: PWNED });
    expect(msg).not.toMatch(/weak|guess/i);
    expect(msg).toBe(PASSWORD_RUBATA);
  });

  it('corta e rubata insieme: conta «rubata», come su /reset-password (allungarla non basta)', () => {
    const atteso = traduciErroreNuovaPassword({ message: CORTA_E_RUBATA, code: 'weak_password', reasons: ['length', 'pwned'] });
    expect(atteso).toBe(PASSWORD_RUBATA);
    expect(traduciErroreAuth(CORTA_E_RUBATA)).toBe(atteso);
    expect(friendlyError({ code: 'weak_password', status: 422, message: CORTA_E_RUBATA })).toBe(atteso);
  });

  it('la password troppo semplice ha il suo consiglio, uguale a /reset-password', () => {
    const msg = friendlyError({ code: 'weak_password', status: 422, message: SEMPLICE });
    expect(msg).not.toMatch(/should contain|character/i);
    expect(msg).toBe(traduciErroreNuovaPassword({ message: SEMPLICE, code: 'weak_password', reasons: ['characters'] }));
  });

  it('un testo nuovo col codice weak_password esce comunque in italiano', () => {
    const msg = friendlyError({ code: 'weak_password', status: 422, message: 'Password rejected by policy XYZ' });
    expect(msg).not.toMatch(/rejected|policy/i);
  });
});

describe('sulla pagina di iscrizione vera', () => {
  type Pagina = ComponentType<Record<string, unknown>>;
  const g = globalThis as unknown as Record<string, unknown> & {
    __NAVIGAZIONI__?: unknown[];
    __AUTH_FINTA__?: Record<string, (...a: unknown[]) => unknown>;
  };
  let Registrazione: Pagina;
  const montate: Array<{ smonta: () => void }> = [];

  beforeAll(async () => {
    Registrazione = (await monta('app/sign-up/page.tsx')).default as Pagina;
  }, 120000);
  afterEach(() => {
    while (montate.length) montate.pop()!.smonta();
    delete g.__QUERY_FINTA__;
    delete g.__NAVIGAZIONI__;
    delete g.__AUTH_FINTA__;
    vi.unstubAllGlobals();
  });

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

  it('IL CASO CHE ROMPEVA — «Password123!» rifiutata: sotto il campo si legge cosa cambiare, in italiano', async () => {
    // Supabase rifiuta la password come la rifiuta davvero (AuthWeakPasswordError). La risposta è
    // la stessa per le due strade: `signUp` dal browser, oggi, e la rotta di R24-020 quando la
    // regista la cuce.
    const rifiuti: string[] = [];
    g.__AUTH_FINTA__ = {
      signUp: () => {
        rifiuti.push('signUp');
        return {
          data: { user: null, session: null },
          error: { name: 'AuthWeakPasswordError', status: 422, code: 'weak_password', reasons: ['pwned'], message: PWNED },
        };
      },
    };
    vi.stubGlobal('fetch', async (dove: unknown) => {
      if (String(dove) !== '/api/auth/registrazione') return { ok: true, status: 200, json: async () => ({}) };
      rifiuti.push('rotta');
      return { ok: false, status: 422, json: async () => ({ ok: false, error: { code: 'weak_password', message: PWNED } }) };
    });
    g.__NAVIGAZIONI__ = [];
    window.history.replaceState(null, '', '/sign-up');
    g.__QUERY_FINTA__ = '';
    g.__PERCORSO_FINTO__ = '/sign-up';
    const s = accendi(Registrazione);
    montate.push(s);
    await aspettaChe(() => !!s.radice.querySelector('#signup-email'));

    scrivi(s.radice.querySelector<HTMLInputElement>('#signup-name')!, 'Anna Bianchi');
    scrivi(s.radice.querySelector<HTMLInputElement>('#signup-email')!, 'anna@esempio.it');
    scrivi(s.radice.querySelector<HTMLInputElement>('#signup-password')!, 'Password123!');
    s.agisci(() => s.radice.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    void act(() => {
      s.radice.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await aspettaChe(() => !!s.radice.querySelector('[role="alert"]'));

    const avviso = testoVisibile(s.radice.querySelector('[role="alert"]'));
    expect(rifiuti, 'la pagina non ha chiesto a nessuno di creare l’account').toHaveLength(1);
    expect(avviso, 'nessun avviso: la prova non guarda niente').not.toBe('');
    expect(avviso).not.toMatch(/weak|guess/i);
    expect(avviso).toBe(PASSWORD_RUBATA);
  }, 30000);
});

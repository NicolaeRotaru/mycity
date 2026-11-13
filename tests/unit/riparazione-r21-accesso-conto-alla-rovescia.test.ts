/**
 * @vitest-environment jsdom
 */
/**
 * R21-018 — Dopo troppi tentativi di accesso «Accedi» restava premibile e la
 * pagina non diceva quanto aspettare: il 429 arrivava con Retry-After, ma la
 * pagina non leggeva l'intestazione.
 *
 * Qui la pagina VERA di accesso, montata: la rotta risponde 429 con
 * Retry-After, e si guarda il pulsante — spento, col conto alla rovescia, e di
 * nuovo «Accedi» quando l'attesa è finita.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

type Pagina = ComponentType<Record<string, unknown>>;
const g = globalThis as unknown as Record<string, unknown>;

let Accesso: Pagina;
beforeAll(async () => {
  Accesso = (await monta('app/sign-in/page.tsx')).default as Pagina;
}, 120000);

const montate: Array<{ smonta: () => void }> = [];

function scrivi(campo: HTMLInputElement, valore: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  void act(() => {
    setter.call(campo, valore);
    campo.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
function invia(modulo: HTMLFormElement) {
  void act(() => {
    modulo.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
}
async function aspettaChe(vero: () => boolean, ms = 4000): Promise<void> {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (vero()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}
function pulsanteDiInvio(radice: HTMLElement): HTMLButtonElement {
  return radice.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
}

/** La rotta risponde sempre 429 col Retry-After dato; conta le chiamate. */
function rispondeIlFreno(retryAfter: string) {
  const chiamate: string[] = [];
  vi.stubGlobal('fetch', async (dove: unknown) => {
    chiamate.push(String(dove));
    return {
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': retryAfter }),
      json: async () => ({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Troppi tentativi su questo account. Riprova fra 5 minuti.' },
      }),
    };
  });
  return chiamate;
}

async function provaAdAccedere() {
  window.history.replaceState(null, '', '/sign-in');
  g.__QUERY_FINTA__ = '';
  g.__PERCORSO_FINTO__ = '/sign-in';
  const s = accendi(Accesso);
  montate.push(s);
  await aspettaChe(() => !!s.radice.querySelector('#signin-email'));
  scrivi(s.radice.querySelector<HTMLInputElement>('#signin-email')!, 'maria.rossi@esempio.it');
  scrivi(s.radice.querySelector<HTMLInputElement>('#signin-password')!, 'una-password-sbagliata');
  invia(s.radice.querySelector('form')!);
  return s;
}

beforeEach(() => {
  window.sessionStorage.clear();
  g.__NAVIGAZIONI__ = [];
  g.__AUTH_FINTA__ = {};
});
afterEach(() => {
  while (montate.length) montate.pop()!.smonta();
  delete g.__QUERY_FINTA__;
  delete g.__NAVIGAZIONI__;
  delete g.__AUTH_FINTA__;
  vi.unstubAllGlobals();
});

describe('R21-018 dopo troppi tentativi «Accedi» si spegne e dice quanto manca', () => {
  it('IL CASO DELLA PALESTRA — 429 con Retry-After 261: pulsante spento, «4:21», e un secondo invio non parte', async () => {
    const chiamate = rispondeIlFreno('261');
    const s = await provaAdAccedere();
    await aspettaChe(() => /4:2\d/.test(testoVisibile(pulsanteDiInvio(s.radice))));

    const pulsante = pulsanteDiInvio(s.radice);
    expect(testoVisibile(pulsante), 'il pulsante non dice quanto aspettare').toMatch(/fra 4:2[01]/);
    expect(pulsante.disabled, '«Accedi» resta premibile durante l’attesa').toBe(true);
    expect(testoVisibile(s.radice)).toContain('Riprova fra 5 minuti.');

    // Chi ritenta (Invio sulla tastiera) non manda niente al server.
    invia(s.radice.querySelector('form')!);
    await aspettaChe(() => false, 100);
    expect(chiamate, 'durante l’attesa il modulo ha richiamato la rotta').toHaveLength(1);

    // Il conto scende.
    await aspettaChe(() => /fra 4:(1\d|20)/.test(testoVisibile(pulsanteDiInvio(s.radice))) && !/4:21/.test(testoVisibile(pulsanteDiInvio(s.radice))), 2500);
    expect(testoVisibile(pulsanteDiInvio(s.radice))).not.toMatch(/4:21/);
  }, 30000);

  it('finita l’attesa torna «Accedi», premibile, e la frase dell’attesa sparisce', async () => {
    rispondeIlFreno('2');
    const s = await provaAdAccedere();
    await aspettaChe(() => /fra 0:0/.test(testoVisibile(pulsanteDiInvio(s.radice))));
    expect(testoVisibile(pulsanteDiInvio(s.radice))).toMatch(/fra 0:0[12]/);
    expect(pulsanteDiInvio(s.radice).disabled).toBe(true);

    await aspettaChe(() => /^Accedi$/.test(testoVisibile(pulsanteDiInvio(s.radice)).trim()), 4000);
    expect(pulsanteDiInvio(s.radice).disabled).toBe(false);
    expect(testoVisibile(s.radice)).not.toContain('Riprova fra 5 minuti.');
  }, 30000);
});

/**
 * @vitest-environment jsdom
 */
/**
 * 27/11/2026 (R09-014) — UNA BOZZA DELLA CASSA CHE NON SI LEGGE RESTA NEL BROWSER.
 *
 * La cassa mette da parte nel browser (localStorage) l'indirizzo scritto da ospite prima di
 * mandarlo all'accesso, e lo toglie quando lo riprende. Ma se la bozza non si leggeva (JSON rotto,
 * oppure di forma sbagliata: `null`, un numero, una stringa) la lettura usciva PRIMA della
 * cancellazione, e la bozza coi dati dell'ospite restava nel browser per sempre.
 *
 * Qui la pagina di cassa si MONTA intera, con la bozza illeggibile già nel browser.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, info: () => undefined, error: () => undefined }),
}));

const globale = globalThis as Record<string, unknown>;
const MARIA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it' };

globalThis.fetch = (async () => ({
  ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null,
})) as unknown as typeof fetch;

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  delete globale.__DATI_QUERY__;
  delete globale.__UTENTE__;
  delete globale.__MUTAZIONI__;
});

async function apriLaCassa() {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  // Giovedì 29/10/2026 alle 18:00 di Roma.
  vi.setSystemTime(new Date('2026-10-29T17:00:00Z'));
  globale.__UTENTE__ = MARIA;
  globale.__MUTAZIONI__ = [];
  globale.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [chi] = o.queryKey;
    if (chi === 'auth-user') return MARIA;
    if (chi === 'user-addresses') return [];
    return undefined;
  };
  const pagina = (await monta('app/checkout/page.tsx')).default;
  schermo = accendi(pagina, {});
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe('R09-014 — la bozza illeggibile si toglie dal browser', () => {
  // Il controllo che la prova misuri: una bozza buona si riprende e si toglie (come prima).
  it('una bozza buona si riprende e si toglie', async () => {
    localStorage.setItem('mc_checkout_draft', JSON.stringify({ form: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: '' } }));
    await apriLaCassa();
    expect(localStorage.getItem('mc_checkout_draft')).toBeNull();
  }, 30_000);

  const ILLEGGIBILI: Array<[string, string]> = [
    ['JSON rotto', '{"form":{"fullName":"Maria Rossi","address":"Via Verdi 10"'],
    ['null', 'null'],
    ['un numero', '42'],
    ['una stringa', '"Maria Rossi, Via Verdi 10"'],
  ];

  for (const [nome, grezza] of ILLEGGIBILI) {
    it(`una bozza illeggibile (${nome}) in localStorage non resta nel browser`, async () => {
      localStorage.setItem('mc_checkout_draft', grezza);
      await apriLaCassa();
      expect(localStorage.getItem('mc_checkout_draft'), `la bozza illeggibile (${nome}) è rimasta nel browser`).toBeNull();
    }, 30_000);
  }

  it('una bozza illeggibile nella memoria della scheda (sessionStorage) non resta', async () => {
    sessionStorage.setItem('mc_checkout_draft', '{rotto');
    await apriLaCassa();
    expect(sessionStorage.getItem('mc_checkout_draft'), 'la bozza illeggibile è rimasta in sessionStorage').toBeNull();
  }, 30_000);
});

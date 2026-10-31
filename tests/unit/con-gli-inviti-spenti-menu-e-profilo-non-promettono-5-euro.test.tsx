/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { getAccountMenuItems, type MenuRole } from '@/lib/account-menu';
import { INVITI_E_PUNTI_ACCESI } from '@/lib/funzioni-al-lancio';

/**
 * 31/10/2026 — CON GLI INVITI SPENTI NESSUNO PROMETTE ANCORA I 5 EURO.
 *
 * Al lancio inviti e punti sono spenti (`INVITI_E_PUNTI_ACCESI`, carta #209): la pagina
 * /profile/referral dice «gli inviti non sono ancora attivi, non c'è un premio». Ma due
 * porte che ci portano promettevano ancora i soldi:
 *  ① il menu dell'account di Maria (cliente) scriveva «Invita amici · €5 per te»;
 *  ② la pagina del profilo aveva il riquadro «Invita un amico, ricevi €5 di credito».
 * Maria clicca, legge «niente premio»: la stessa persona riceve due risposte opposte.
 *
 * Il menu non porta più cifre nell'etichetta: la promessa vive solo nella pagina degli
 * inviti, che segue l'interruttore. Il riquadro del profilo si accende con l'interruttore.
 */

const EURO = /€\s*\d/;
const RUOLI: MenuRole[] = ['buyer', 'seller', 'rider', 'admin', null];

describe('il menu dell’account non promette soldi nell’etichetta', () => {
  it('con gli inviti spenti la voce «invita amici» di Maria non dice €5', () => {
    expect(INVITI_E_PUNTI_ACCESI).toBe(false);
    const voce = getAccountMenuItems('buyer').find((v) => v.href === '/profile/referral');
    expect(voce, 'la voce degli inviti è sparita dal menu del cliente').toBeDefined();
    expect(voce!.label).not.toMatch(EURO);
  });

  it.each(RUOLI.map((r) => [String(r), r] as const))('nessuna voce del menu di %s porta una cifra in euro', (_n, ruolo) => {
    const conCifra = getAccountMenuItems(ruolo).map((v) => v.label).filter((l) => EURO.test(l));
    expect(conCifra).toEqual([]);
  });
});

type Pagina = ComponentType<Record<string, unknown>>;
const g = globalThis as unknown as Record<string, unknown>;
let Profilo: Pagina;
const montate: Array<{ smonta: () => void }> = [];

beforeAll(async () => {
  const m = await monta('app/profile/page.tsx');
  Profilo = m.default as Pagina;
}, 120000);

afterEach(() => {
  while (montate.length) montate.pop()!.smonta();
  delete g.__DATI_QUERY__;
  delete g.__UTENTE__;
});

async function aspettaChe(vero: () => boolean, ms = 3000): Promise<void> {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (vero()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

describe('la pagina del profilo con gli inviti spenti', () => {
  it('Maria apre il profilo: niente «ricevi €5 di credito», niente riquadro che porta agli inviti', async () => {
    g.__UTENTE__ = { id: 'maria-1', email: 'maria@example.it' };
    g.__DATI_QUERY__ = {
      id: 'maria-1',
      email: 'maria@example.it',
      full_name: 'Maria Rossi',
      created_at: '2026-09-01T10:00:00Z',
    };
    window.history.replaceState(null, '', '/profile');
    g.__PERCORSO_FINTO__ = '/profile';
    const s = accendi(Profilo);
    montate.push(s);
    await aspettaChe(() => /Maria Rossi/.test(testoVisibile(s.radice)));
    const testo = testoVisibile(s.radice);
    expect(testo, 'la pagina del profilo non si è disegnata').toMatch(/Maria Rossi/);
    expect(testo).not.toMatch(EURO);
    expect(testo).not.toMatch(/ricevi\s*€/i);
    expect(s.radice.querySelector('a[href="/profile/referral"]')).toBeNull();
  });
});

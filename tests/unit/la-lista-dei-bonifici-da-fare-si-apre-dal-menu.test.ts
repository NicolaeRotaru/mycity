/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { PAGINA_DEI_BONIFICI_DA_FARE } from '@/lib/rimborsi/scelta-del-reso';

/**
 * 16/10/2026 — LA LISTA DEI BONIFICI DI RIMBORSO DA FARE NON AVEVA UNA PORTA.
 *
 * Il lotto ha creato `/admin/rimborsi-da-bonificare`: l'unico posto con l'IBAN del cliente e il
 * pulsante «Bonifico fatto». Ma nel menu dell'amministratore non c'era, e nessuna pagina ci
 * portava. Ci si arrivava solo dall'avviso «Bonifico di rimborso da fare» nella campanella: un
 * «segna tutte come lette», o l'avviso che scivola oltre gli ultimi 50, e la lista si raggiungeva
 * solo scrivendo l'indirizzo a mano. Intanto l'ordine diceva gia' «rimborsato», e il cliente che
 * aveva pagato in contanti aspettava un bonifico che per legge va fatto entro 14 giorni.
 *
 * La prova MONTA il menu vero — quello del computer e quello del telefono — e cerca la voce che
 * apre la lista, come la cercherebbe Nicola. Se la voce sparisce dal menu, diventa rossa.
 */

let Menu: ComponentType<Record<string, unknown>>;
let MenuDelTelefono: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  const modulo = await monta('components/admin/AdminSidebar.tsx');
  Menu = modulo.default as ComponentType<Record<string, unknown>>;
  MenuDelTelefono = modulo.AdminMobileTopbar as ComponentType<Record<string, unknown>>;
}, 60000);

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__PERCORSO_FINTO__;
  delete (globalThis as Record<string, unknown>).__PROFILO__;
});

/** Le voci del menu che portano alla lista dei bonifici da fare. */
function vociVersoIBonifici(radice: Element) {
  return Array.from(radice.querySelectorAll('a[href]')).filter(
    (a) => a.getAttribute('href') === PAGINA_DEI_BONIFICI_DA_FARE,
  );
}

describe('il menu dell amministratore porta alla lista dei bonifici da fare', () => {
  it('la pagina a cui porta la voce esiste davvero', () => {
    expect(
      existsSync(join(process.cwd(), 'app', ...PAGINA_DEI_BONIFICI_DA_FARE.split('/').filter(Boolean), 'page.tsx')),
      'la voce del menu porterebbe a una pagina che non c e',
    ).toBe(true);
  });

  it('sul computer: nel menu laterale c e la voce «Rimborsi da bonificare»', () => {
    (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = '/admin/orders';
    const s = accendi(Menu);
    const tutte = s.radice.querySelectorAll('nav a[href]');
    expect(tutte.length, 'il menu non e comparso: la prova non sta guardando niente').toBeGreaterThan(5);

    const voci = vociVersoIBonifici(s.radice);
    expect(
      voci,
      'nel menu non c e nessuna voce verso i bonifici da fare: ci si arriva solo da un avviso che si perde',
    ).toHaveLength(1);
    expect(testoVisibile(voci[0])).toBe('Rimborsi da bonificare');
    s.smonta();
  }, 60000);

  it('la voce si accende quando sei sulla lista', () => {
    (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = PAGINA_DEI_BONIFICI_DA_FARE;
    const s = accendi(Menu);
    const [voce] = vociVersoIBonifici(s.radice);
    expect(voce?.getAttribute('aria-current')).toBe('page');
    s.smonta();
  }, 60000);

  it('sul telefono: la stessa voce sta nel cassetto del menu', () => {
    (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = '/admin/orders';
    const s = accendi(MenuDelTelefono);
    const apri = s.radice.querySelector('button[aria-label="Apri menu"]');
    expect(apri, 'il pulsante che apre il menu del telefono non c e').not.toBeNull();
    s.agisci(() => (apri as HTMLButtonElement).click());
    expect(vociVersoIBonifici(s.radice), 'dal telefono la lista dei bonifici non si apre dal menu').toHaveLength(1);
    s.smonta();
  }, 60000);
});

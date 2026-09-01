/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { monta, nomeAccessibile, controlli } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 27/8/2026 (R109) — CINQUE NOTIFICHE NON LETTE, E IL LETTORE DICEVA SOLO
 * «NOTIFICHE».
 *
 * Nella barra in alto le tre icone con la pallina del numero — Preferiti,
 * Messaggi, Notifiche — mettevano `aria-label="Notifiche"` sul link. Un
 * `aria-label` non si aggiunge al contenuto: lo SOSTITUISCE. Quindi la pallina
 * col numero, che sta dentro il link, non veniva mai pronunciata: chi ascolta
 * la pagina non aveva modo di sapere che c'erano cinque messaggi da leggere, e
 * quindi nessun motivo per aprirli.
 *
 * Lo stesso identico difetto era già stato corretto venti righe più in basso,
 * sul carrello (la nota «#137» nel file lo racconta): là il nome si compone dal
 * contenuto e c'è un pezzo nascosto che dice «, 3 articoli». Le tre icone
 * sopra erano rimaste indietro. Stessa cosa nella barra in fondo del telefono,
 * dove il numero c'era ma nudo: si sentiva «3 Carrello», che non vuol dire
 * niente.
 *
 * Questa prova monta i due componenti veri e chiede il nome che verrebbe
 * pronunciato: se il numero non c'è, diventa rossa.
 */

describe('le icone con la pallina del numero, nella barra in alto', () => {
  it('dicono quante notifiche non lette ci sono, non solo «Notifiche»', async () => {
    const mod = await monta('components/Navbar.tsx');
    const s = accendi(mod.IconButton, {
      href: '/notifications',
      label: 'Notifiche',
      badge: 5,
      children: null,
    });
    const link = s.radice.querySelector('a')!;
    const nome = nomeAccessibile(link);
    expect(nome, 'Il nome deve continuare a dire di che icona si tratta').toContain('Notifiche');
    expect(
      nome,
      `Con 5 notifiche non lette il lettore diceva «${nome}»: il numero non usciva mai dalla bocca del lettore`,
    ).toMatch(/5/);
    s.smonta();
  }, 60000);

  it('senza pallina restano quello che erano', async () => {
    const mod = await monta('components/Navbar.tsx');
    const s = accendi(mod.IconButton, { href: '/messages', label: 'Messaggi', children: null });
    expect(nomeAccessibile(s.radice.querySelector('a')!)).toBe('Messaggi');
    s.smonta();
  }, 60000);
});

describe('la barra in fondo del telefono', () => {
  beforeEach(() => {
    localStorage.setItem(
      'cart',
      JSON.stringify([{ id: 'p1', name: 'Focaccia', price: 3, quantity: 3, sellerId: 's1', storeName: 'Pane Quotidiano' }]),
    );
  });

  it('il carrello dice quanti articoli ci sono dentro, con la loro unità', async () => {
    const mod = await monta('components/MobileTabBar.tsx');
    const s = accendi(mod.default, {});
    const carrello = controlli(s.radice).find((c) => nomeAccessibile(c).includes('Carrello'))!;
    expect(carrello, 'La tab del carrello non si trova più').toBeTruthy();
    const nome = nomeAccessibile(carrello);
    expect(nome, `Si sentiva «${nome}»: un numero nudo, senza dire di cosa`).toMatch(/3\s*(articol|prodott)/i);
    s.smonta();
  }, 60000);
});

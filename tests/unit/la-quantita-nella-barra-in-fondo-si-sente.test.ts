/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 30/8/2026 (R108) — SUL TELEFONO LA QUANTITA' CAMBIAVA IN SILENZIO.
 *
 * La stessa cosa era fatta in tre punti e in due su tre era fatta bene: nella
 * scheda prodotto e nel carrello il numero della quantita' sta dentro un
 * `<output aria-live="polite">`, quindi chi non vede lo schermo preme «+» e
 * sente il nuovo numero. Nella barra fissa in fondo — che sul telefono E' il
 * modo con cui si compra — il numero stava dentro uno `<span>` normale: si
 * premeva «+» tre volte, non si sentiva niente, e non c'era modo di sapere se
 * si stava comprando una confezione o quattro finche' non si arrivava al
 * carrello. Criterio WCAG 4.1.2.
 *
 * Nello stesso pezzo c'erano due `aria-label` messe su `<div>` senza ruolo —
 * «Aggiungi al carrello (sticky)» e «Quantita'» — che le tecnologie assistive
 * buttano via: un'etichetta su un contenitore generico non viene esposta, ed e'
 * un'etichetta che chi la scrive crede di aver dato.
 *
 * Questa prova monta la barra vera, con la quantita' a 3, e chiede due cose che
 * si possono chiedere solo al DOM renderizzato: che il numero stia dentro una
 * regione che il lettore rilegge da sola, e che nessuna etichetta sia appesa a
 * un elemento che non puo' portarne una.
 */

/** I tag che un nome accessibile lo portano da soli, senza bisogno di un ruolo. */
const PORTANO_UN_NOME = new Set([
  'a', 'button', 'input', 'select', 'textarea', 'img', 'output', 'nav', 'main',
  'header', 'footer', 'aside', 'section', 'form', 'table', 'dialog', 'details',
]);

/** Vero se il lettore di schermo rilegge da solo questo elemento quando cambia. */
function dentroUnaRegioneCheParla(el: Element | null): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const vivo = n.getAttribute('aria-live');
    if (vivo === 'polite' || vivo === 'assertive') return true;
    // `<output>` e' una regione viva per definizione: il browser gli da'
    // aria-live="polite" senza che nessuno lo scriva.
    if (n.tagName.toLowerCase() === 'output') return true;
  }
  return false;
}

async function barraConTre() {
  // La barra si mostra solo dopo che si e' scorso oltre meta' del primo schermo.
  Object.defineProperty(window, 'scrollY', { value: 2000, writable: true, configurable: true });
  const mod = await monta('components/StickyAddToCart.tsx');
  return accendi(mod.default, {
    price: 4.5,
    available: true,
    onAdd: () => {},
    qty: 3,
    onDec: () => {},
    onInc: () => {},
  });
}

describe('la barra «Aggiungi al carrello» in fondo al telefono', () => {
  it('annuncia la quantita quando cambia, invece di cambiarla in silenzio', async () => {
    const s = await barraConTre();

    const piu = Array.from(s.radice.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Aumenta quantità',
    );
    expect(piu, 'senza il pulsante «+» questa prova non sta misurando la barra giusta').toBeTruthy();

    // Il numero della quantita': l'elemento con dentro solo «3», accanto ai due
    // pulsanti dello stepper.
    const stepper = piu!.parentElement!;
    const numero = Array.from(stepper.children).find(
      (c) => c.tagName.toLowerCase() !== 'button' && c.textContent?.trim() === '3',
    );
    expect(numero, 'il numero della quantita non e piu dove lo stepper lo disegna').toBeTruthy();

    expect(
      dentroUnaRegioneCheParla(numero!),
      'Chi non vede lo schermo preme «+» e non sente niente: il numero della quantita non sta in una regione che il lettore rilegge',
    ).toBe(true);

    s.smonta();
  }, 60000);

  it('non appende etichette a contenitori che non possono portarle', async () => {
    const s = await barraConTre();

    const perse = Array.from(s.radice.querySelectorAll('[aria-label]')).filter((el) => {
      const tag = el.tagName.toLowerCase();
      return !PORTANO_UN_NOME.has(tag) && !el.getAttribute('role');
    });

    expect(
      perse.map((el) => `${el.tagName.toLowerCase()}[aria-label="${el.getAttribute('aria-label')}"]`),
      'Un aria-label su un <div> senza ruolo non viene esposto: chi lo ha scritto crede di aver dato un nome e non lo ha dato',
    ).toEqual([]);

    s.smonta();
  }, 60000);
});

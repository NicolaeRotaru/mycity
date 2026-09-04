/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * SETTE DESTINAZIONI, E SUL TELEFONO SE NE VEDEVA UNA.
 *
 * Sotto la barra in alto c'è la riga «Tutte le categorie · Tutti i negozi ·
 * Promozioni · Novità · Regali · Vicino a te · Più venduti · Piccoli prezzi».
 * Scorre in orizzontale, ma la sua barra di scorrimento è nascosta
 * (`scrollbar-hide`) e al suo posto non c'era niente: nessuna sfumatura,
 * nessuna freccia. Su uno schermo da telefono si vedeva il primo pulsante e
 * poco altro, e niente diceva che a destra continuava. Le pagine che portano a
 * comprare — Promozioni, Più venduti, Piccoli prezzi — restavano invisibili.
 *
 * jsdom non impagina, quindi le misure gliele diamo noi: è il modo di
 * accendere davvero il meccanismo e vedere cosa fa. Il segno deve comparire
 * quando c'è dell'altro oltre il bordo, e sparire quando ci sta tutto: un
 * segno che c'è sempre non è un aiuto, è una bugia.
 */

function misuraFinta(el: Element, misure: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
  for (const [nome, valore] of Object.entries(misure)) {
    Object.defineProperty(el, nome, { value: valore, configurable: true });
  }
}

async function rigaDelleCategorie() {
  (globalThis as Record<string, unknown>).__DATI_QUERY__ = undefined;
  const mod = await monta('components/CategoryBar.tsx');
  const s = accendi(mod.default, {});
  const riga = s.radice.querySelector('.overflow-x-auto');
  expect(riga, 'La riga scorrevole delle categorie non c\'è più: la prova non guarda niente').toBeTruthy();
  return { s, riga: riga! };
}

const segno = (radice: HTMLElement, lato: 'sinistra' | 'destra') =>
  radice.querySelector(`[data-scorrimento="${lato}"]`);

describe('la riga delle categorie sul telefono', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('quando a destra c\'è dell\'altro, lo fa vedere', async () => {
    const { s, riga } = await rigaDelleCategorie();
    // Otto voci in una riga larga come uno schermo da 360.
    misuraFinta(riga, { scrollWidth: 900, clientWidth: 360, scrollLeft: 0 });
    s.agisci(() => riga.dispatchEvent(new window.Event('scroll')));

    expect(
      segno(s.radice, 'destra'),
      'La riga continua oltre il bordo destro e niente lo dice: Promozioni, Più venduti e Piccoli prezzi restano invisibili',
    ).toBeTruthy();
    expect(segno(s.radice, 'sinistra'), 'A sinistra non c\'è ancora niente da tornare a vedere').toBeFalsy();
    s.smonta();
  }, 60000);

  it('arrivati in fondo il segno passa dall\'altra parte', async () => {
    const { s, riga } = await rigaDelleCategorie();
    misuraFinta(riga, { scrollWidth: 900, clientWidth: 360, scrollLeft: 540 });
    s.agisci(() => riga.dispatchEvent(new window.Event('scroll')));

    expect(segno(s.radice, 'destra'), 'Siamo in fondo: non c\'è più niente a destra da annunciare').toBeFalsy();
    expect(segno(s.radice, 'sinistra'), 'Le prime voci sono rimaste indietro e niente lo dice').toBeTruthy();
    s.smonta();
  }, 60000);

  it('se le voci ci stanno tutte non compare nessun segno', async () => {
    const { s, riga } = await rigaDelleCategorie();
    misuraFinta(riga, { scrollWidth: 900, clientWidth: 900, scrollLeft: 0 });
    s.agisci(() => riga.dispatchEvent(new window.Event('scroll')));

    expect(segno(s.radice, 'destra'), 'Un segno che dice «continua» quando non continua è una bugia').toBeFalsy();
    expect(segno(s.radice, 'sinistra')).toBeFalsy();
    s.smonta();
  }, 60000);

  it('il segno non ruba i tocchi né parla ai lettori di schermo', async () => {
    const { s, riga } = await rigaDelleCategorie();
    misuraFinta(riga, { scrollWidth: 900, clientWidth: 360, scrollLeft: 0 });
    s.agisci(() => riga.dispatchEvent(new window.Event('scroll')));

    const sfumatura = segno(s.radice, 'destra')!;
    expect(
      sfumatura.className.includes('pointer-events-none'),
      'La sfumatura sta sopra l\'ultima voce: se prende lei il tocco, quella voce non si apre più',
    ).toBe(true);
    expect(
      sfumatura.getAttribute('aria-hidden'),
      'È un aiuto per gli occhi: a chi ascolta la pagina non deve dire niente',
    ).toBe('true');
    s.smonta();
  }, 60000);
});

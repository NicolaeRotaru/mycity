/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { NEGOZI_IN_VETRINA } from '@/lib/queries/vetrina-negozi';

/**
 * 6/9/2026 — LO SCHELETRO DELLA VETRINA IN HOME NON ASSOMIGLIAVA A QUELLO CHE
 * ARRIVAVA DOPO, E IL SALTO DELLA PAGINA LO CAUSAVA LUI.
 *
 * Lo scheletro serve a tenere ferma la pagina mentre i negozi arrivano: se
 * occupa lo stesso spazio, quando i dati atterrano non si muove niente. Qui
 * faceva il contrario di quello che prometteva il suo commento.
 *
 * ① Erano quattro riquadri per sei negozi (la vetrina chiede `.limit(6)`). Da
 *    telefono, su due colonne, l'attesa mostrava due righe e i negozi veri ne
 *    portano tre: nasce una riga intera e tutto quello che sta sotto scende.
 *
 * ② Il riquadro-foto era `aspect-[4/3]`, mentre la copertina vera è alta 112 px
 *    fissi (`h-28`). Su schermo grande, con colonne da circa 280 px, lo
 *    scheletro era alto più o meno il doppio di quello che lo sostituiva.
 */

const globali = globalThis as Record<string, unknown>;

afterEach(() => {
  delete globali.__DATI_QUERY__;
  delete globali.__ESITO_QUERY__;
});

/** La vetrina mentre i negozi non sono ancora arrivati. */
async function vetrinaInAttesa() {
  globali.__DATI_QUERY__ = undefined;
  globali.__ESITO_QUERY__ = { data: undefined, isLoading: true, isPending: true, isSuccess: false };
  const mod = await monta('components/StoreShowcase.tsx');
  return accendi(mod.default, {});
}

describe('lo scheletro della vetrina negozi', () => {
  it('IL CASO CHE ROMPEVA — tiene il posto di tutti i negozi che arrivano, non di quattro', async () => {
    const s = await vetrinaInAttesa();
    const griglia = s.radice.querySelector('div.grid');
    const riquadri = griglia ? Array.from(griglia.children) : [];

    expect(riquadri.length, 'lo scheletro non e a video: la prova sotto non proverebbe niente').toBeGreaterThan(0);
    expect(
      riquadri.length,
      `l attesa tiene il posto di ${riquadri.length} negozi ma ne arrivano ${NEGOZI_IN_VETRINA}: nasce una riga intera e la pagina salta`,
    ).toBe(NEGOZI_IN_VETRINA);

    s.smonta();
  });

  it('IL CASO CHE ROMPEVA — il riquadro-foto e alto quanto la copertina vera', async () => {
    const s = await vetrinaInAttesa();
    const primo = s.radice.querySelector('div.grid > div');
    const riquadroFoto = primo?.firstElementChild as HTMLElement | null;

    expect(riquadroFoto, 'il riquadro della foto non c e piu').not.toBeNull();
    expect(
      riquadroFoto?.className ?? '',
      'il riquadro-foto dell attesa ha proporzioni sue (aspect-[4/3]) e non l altezza della copertina vera: quando la foto arriva la pagina si accorcia',
    ).toContain('h-28');
    expect(riquadroFoto?.className ?? '').not.toContain('aspect-');

    s.smonta();
  });

  it("l altezza dello scheletro e la stessa che la scheda vera dà alla copertina", async () => {
    // Il numero non si scrive due volte: se `StorePreviewCard` cambia altezza,
    // questa prova diventa rossa e lo scheletro va rifatto insieme a lei.
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const radice = path.resolve(__dirname, '../..');
    const scheda = readFileSync(path.join(radice, 'components/StorePreviewCard.tsx'), 'utf8');
    const altezzaVera = scheda.match(/heightClass=\{compact \? '[^']+' : '([^']+)'\}/)?.[1];

    expect(altezzaVera, 'la copertina della scheda negozio non dichiara piu la sua altezza').toBe('h-28');

    const s = await vetrinaInAttesa();
    const riquadroFoto = s.radice.querySelector('div.grid > div')?.firstElementChild as HTMLElement | null;
    expect(riquadroFoto?.className ?? '').toContain(altezzaVera as string);

    s.smonta();
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { colore } from './aiuti/tavolozza-del-sito';
import { contrasto, daEsadecimale, BIANCO, SOGLIA_TESTO, SOGLIA_GRAFICA } from './aiuti/contrasto';

/**
 * R08-013 — le tessere delle categorie in home senza foto.
 *
 * ① Il velo pieno (pensato per le foto) si disegna solo sopra una foto che si
 *   è caricata: se la foto c'è nel dato ma non carica, la tessera torna al
 *   gradiente col velo leggero, senza banda chiara.
 * ② Il velo leggero sale senza risalite (niente banda chiara a metà) e fa
 *   leggere il nome bianco ad almeno 4,5:1 sulla tessera più chiara (senape).
 *   L'icona bianca sta su un cerchio scuro e resta sopra 3:1.
 * I numeri si leggono dalle classi vere del componente, non da copie.
 */

vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: readonly string[] }) =>
    o.queryKey.join('/') === 'categories/con-prodotti'
      ? { data: undefined, isLoading: false, isError: false }
      : {
          data: [
            { id: 'c1', slug: 'casa-cucina', name: 'Casa & Cucina', parent_id: null,
              image_url: 'https://abcdefgh.supabase.co/storage/v1/object/public/categorie/casa.jpg' },
            { id: 'c2', slug: 'alimentari', name: 'Alimentari', parent_id: null },
          ],
          isLoading: false,
          isError: false,
        },
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } }));

const { default: CategoryShowcase } = await import('@/components/CategoryShowcase');

let radice: Root;
let contenitore: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  radice = createRoot(contenitore);
});
afterEach(() => {
  act(() => radice.unmount());
  contenitore.remove();
});

// Il velo della tessera senza foto (Alimentari), letto da quello che il componente disegna.
function veloSenzaFoto(): string {
  const c = document.createElement('div');
  const r = createRoot(c);
  act(() => r.render(createElement(CategoryShowcase)));
  const classi = velo(c.querySelector('a[href="/category/alimentari"]')!);
  act(() => r.unmount());
  return classi;
}

const velo = (tessera: Element) =>
  Array.from(tessera.querySelectorAll('div')).find((d) => d.className.includes('bg-gradient-to-t'))?.className ?? '';

describe('R08-013 ① — il velo pieno solo sopra una foto che c’è davvero', () => {
  it('foto nel dato che non si carica: la tessera torna al velo leggero', () => {
    act(() => radice.render(createElement(CategoryShowcase)));
    const tessera = contenitore.querySelector('a[href="/category/casa-cucina"]')!;
    expect(velo(tessera)).toContain('from-black/70');
    const img = tessera.querySelector('img')!;
    act(() => { img.dispatchEvent(new Event('error')); });
    expect(velo(tessera)).not.toContain('from-black/70');
    expect(velo(tessera)).toBe(veloSenzaFoto());
  });

  it('senza foto nel dato il velo è quello leggero fin da subito', () => {
    act(() => radice.render(createElement(CategoryShowcase)));
    const tessera = contenitore.querySelector('a[href="/category/alimentari"]')!;
    expect(velo(tessera)).not.toContain('from-black/70');
  });
});

// Le fermate di un velo «from-black/A via-black/B to-black/C|to-transparent», dal basso in alto.
function fermate(classi: string): [number, number, number] {
  const n = (pref: string) => {
    const m = classi.match(new RegExp(`${pref}-(?:black\\/(\\d+)|transparent)`));
    if (!m) throw new Error(`manca ${pref} in «${classi}»`);
    return m[1] ? Number(m[1]) / 100 : 0;
  };
  return [n('from'), n('via'), n('to')];
}
// Il valore del velo a un'altezza h (0 = in basso, 1 = in alto), come lo disegna il browser.
const aAltezza = ([a, b, c]: [number, number, number], h: number) => (h <= 0.5 ? a + (b - a) * (h / 0.5) : b + (c - b) * ((h - 0.5) / 0.5));
const velato = (hex: string, alfa: number) => {
  const [r, g, b] = daEsadecimale(hex);
  const x = (v: number) => Math.round(v * (1 - alfa)).toString(16).padStart(2, '0');
  return `#${x(r)}${x(g)}${x(b)}`;
};

describe('R08-013 ② — sul gradiente il nome si legge e non c’è la banda', () => {
  const senape = colore('accent-400'); // l'inizio del gradiente più chiaro (Casa & Cucina)

  it('il velo senza foto sale senza risalite: nessuna fermata più chiara sotto una più scura', () => {
    const [basso, meta, alto] = fermate(veloSenzaFoto());
    expect(basso).toBeGreaterThanOrEqual(meta);
    expect(meta).toBeGreaterThanOrEqual(alto);
  });

  it('il nome bianco sulla senape sta sopra 4,5:1 fino alla seconda riga (37% d’altezza)', () => {
    const f = fermate(veloSenzaFoto());
    for (const h of [0.1, 0.2, 0.3, 0.37]) {
      expect(contrasto(BIANCO, velato(senape, aAltezza(f, h)))).toBeGreaterThanOrEqual(SOGLIA_TESTO);
    }
  });

  it('l’icona bianca sta su un cerchio scuro e sulla senape resta sopra 3:1', () => {
    act(() => radice.render(createElement(CategoryShowcase)));
    const svg = contenitore.querySelector('a[href="/category/alimentari"] svg')!;
    const cerchio = svg.parentElement!.className;
    const m = cerchio.match(/bg-black\/(\d+)/) ?? ['', '0'];
    const alfaIcona = Number(m[1]) / 100 + aAltezza(fermate(veloSenzaFoto()), 0.9) * (1 - Number(m[1]) / 100);
    expect(contrasto(BIANCO, velato(senape, alfaIcona))).toBeGreaterThanOrEqual(SOGLIA_GRAFICA);
  });

  it('il velo sopra la foto caricata resta quello pieno di prima', () => {
    act(() => radice.render(createElement(CategoryShowcase)));
    expect(velo(contenitore.querySelector('a[href="/category/casa-cucina"]')!)).toContain('from-black/70 via-black/15 to-black/25');
  });
});

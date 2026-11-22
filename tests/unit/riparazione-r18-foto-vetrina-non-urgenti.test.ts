/**
 * R18-005 — «Tutti i prodotti» (StoreProductExplorer) sta in due posti. Nella home del negozio è
 * l'ultima sezione, dentro le schede, sotto la piega: le sue foto non si chiedono come «urgenti». In
 * una pagina del negozio il negoziante può metterla in cima, senza copertina: lì le prime foto sono le
 * candidate al primo disegno grande e restano prioritarie.
 *
 * La prova monta la catena vera (SectionRenderer → ProductGridSection → StoreProductExplorer) come la
 * montano le due pagine, con le schede (home, app/store/[id]/page.tsx) e senza (app/store/[id]/[slug]),
 * e guarda cosa arriva alla griglia.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const visto = vi.hoisted(() => ({ priorita: [] as unknown[] }));

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/ProductGrid', () => ({
  default: (p: { prioritaPrimeFoto?: boolean }) => {
    visto.priorita.push(p.prioritaPrimeFoto);
    return null;
  },
}));

import SectionRenderer from '@/components/store-sections/SectionRenderer';

const ctx = { storeId: 's1', accent: '#C0492C', store: { store_name: 'Pane Quotidiano' }, reviews: [] } as never;
const griglia = { id: 'productGrid', type: 'productGrid', enabled: true, config: {} } as never;
const disegna = (sections: unknown[], tabs: boolean) => {
  visto.priorita = [];
  renderToStaticMarkup(createElement(SectionRenderer, { sections: sections as never, ctx, tabs }));
  return visto.priorita;
};

beforeEach(() => {
  visto.priorita = [];
});

describe('R18-005 le foto della griglia del negozio sono «urgenti» solo dove può stare in cima', () => {
  it('home del negozio (con le schede): la griglia non chiede le foto come urgenti', () => {
    expect(disegna([griglia], true)).toEqual([false]);
  });
  it('pagina del negozio (senza schede), griglia in cima: le prime foto restano prioritarie', () => {
    const p = disegna([griglia], false);
    expect(p).toHaveLength(1);
    expect(p[0]).not.toBe(false);
  });
});

describe('R18-005 le altre sedi restano come prima', () => {
  const leggi = (f: string) => readFileSync(join(process.cwd(), ...f.split('/')), 'utf8');
  it('la griglia ha ancora il parametro, acceso se nessuno lo spegne', () => {
    expect(leggi('components/ProductGrid.tsx')).toMatch(/prioritaPrimeFoto = true/);
    expect(leggi('components/home/PromoDeals.tsx')).toMatch(/priority=\{false\}/);
    expect(leggi('components/store-sections/CollectionSection.tsx')).toMatch(/priority=\{false\}/);
  });
});

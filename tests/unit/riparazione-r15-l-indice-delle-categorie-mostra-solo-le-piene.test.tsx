import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

/**
 * R15-010 — l'indice delle categorie non mette in mostra una categoria vuota.
 *
 * /categorie disegnava tutte le madri, anche Giocattoli con zero prodotti (lei e le sue figlie),
 * mentre il piede e il menu la toglievano. Qui si disegna davvero la pagina contro dati finti:
 * Alimentari ha un prodotto (nella figlia Forno), Giocattoli e la sua figlia Lego no.
 * E chi apre comunque una categoria vuota non legge la frase della ricerca («Non abbiamo trovato
 * questo prodotto»): legge che la categoria non ha ancora prodotti.
 */

type Risposta = { data?: unknown; isLoading?: boolean; isError?: boolean };

const mondo = vi.hoisted(() => ({ risposte: {} as Record<string, Risposta> }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: readonly string[] }) => {
    const r = mondo.risposte[o.queryKey.join('/')] ?? {};
    return { data: r.data, isLoading: !!r.isLoading, isError: !!r.isError, refetch: () => {} };
  },
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

const { default: CategoriePage } = await import('@/app/categorie/page');

const CATEGORIE = [
  { id: 'c-ali', slug: 'alimentari', name: 'Alimentari', icon: null, parent_id: null },
  { id: 'c-forno', slug: 'forno', name: 'Forno', icon: null, parent_id: 'c-ali' },
  { id: 'c-pasta', slug: 'pasta', name: 'Pasta', icon: null, parent_id: 'c-ali' },
  { id: 'c-gio', slug: 'giocattoli', name: 'Giocattoli', icon: null, parent_id: null },
  { id: 'c-lego', slug: 'lego', name: 'Lego', icon: null, parent_id: 'c-gio' },
];

beforeEach(() => {
  mondo.risposte = {
    'all-categories-tree': { data: CATEGORIE },
    'categories/con-prodotti': { data: ['c-forno', 'c-ali'] },
  };
});

const pagina = () => renderToStaticMarkup(createElement(CategoriePage));

describe('R15-010 — /categorie', () => {
  it('mostra solo le categorie con almeno un prodotto: Giocattoli e le sue figlie no', () => {
    const html = pagina();
    expect(html).toContain('href="/category/alimentari"');
    expect(html).toContain('href="/category/forno"');
    expect(html).not.toContain('/category/giocattoli');
    expect(html).not.toContain('/category/lego');
    // Una figlia vuota di una madre piena non porta al vuoto nemmeno lei.
    expect(html).not.toContain('/category/pasta');
  });

  it('finché non sa quali sono piene non disegna le schede (niente Giocattoli che compare e sparisce)', () => {
    mondo.risposte['categories/con-prodotti'] = { isLoading: true };
    const html = pagina();
    expect(html).not.toContain('/category/');
  });

  it('se la lettura delle piene fallisce le mostra tutte, come prima', () => {
    mondo.risposte['categories/con-prodotti'] = { isError: true };
    const html = pagina();
    expect(html).toContain('/category/giocattoli');
    expect(html).toContain('/category/alimentari');
  });
});

describe('R15-010 — la pagina di una categoria vuota', () => {
  const src = readFileSync('app/category/[slug]/page.tsx', 'utf8');
  it('non usa la frase della ricerca «Non abbiamo trovato questo prodotto»', () => {
    expect(src).not.toContain("t('noResultsDescription')");
  });
  it('dice che la categoria non ha ancora prodotti', () => {
    expect(src).toMatch(/In questa categoria non ci sono ancora prodotti/);
  });
});

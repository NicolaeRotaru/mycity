/**
 * S09 — Una collezione scelta a mano nella vetrina (scheda 335): il titolo non resta solo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mondo = vi.hoisted(() => ({ risposta: { data: [] as unknown[], isLoading: false, isError: false } }));

vi.mock('@tanstack/react-query', () => ({ useQuery: () => mondo.risposta }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/ProductCard', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: { name: string }) => ce('div', null, p.name) };
});
vi.mock('@/components/ProductGrid', () => ({ default: () => null }));

import CollectionSection from '@/components/store-sections/CollectionSection';

const ctx = { storeId: 's1', accent: '#C0492C', store: { store_name: 'Pane Quotidiano' } } as never;
const config = { heading: 'Le torte della domenica', layout: 'grid', source: { kind: 'manual', productIds: ['p1', 'p2'] } } as never;
const disegna = () => renderToStaticMarkup(createElement(CollectionSection, { ctx, config }));

beforeEach(() => { mondo.risposta = { data: [], isLoading: false, isError: false }; });

describe('335 — la collezione di prodotti finiti', () => {
  it('senza prodotti in vendita non lascia il titolo col vuoto sotto', () => {
    expect(disegna()).toBe('');
  });
  it('in errore non lascia il titolo', () => {
    mondo.risposta = { data: [], isLoading: false, isError: true };
    expect(disegna()).toBe('');
  });
  it('mentre carica mostra titolo e scheletro', () => {
    mondo.risposta = { data: [], isLoading: true, isError: false };
    const html = disegna();
    expect(html).toContain('Le torte della domenica');
    expect(html).toContain('aria-busy="true"');
  });
  it('con i prodotti mostra titolo e schede', () => {
    mondo.risposta = { data: [{ id: 'p1', name: 'Torta di riso', price: 12, images: [] }], isLoading: false, isError: false };
    const html = disegna();
    expect(html).toContain('Le torte della domenica');
    expect(html).toContain('Torta di riso');
  });
});

import VideoSection from '@/components/store-sections/VideoSection';
import { readFileSync } from 'node:fs';

describe('115 — il video di YouTube non si carica senza che la persona lo chieda', () => {
  it('nella vetrina al posto dell\'iframe c\'è il pulsante «Guarda il video»', () => {
    const html = renderToStaticMarkup(
      createElement(VideoSection, { ctx, config: { heading: 'Il forno', provider: 'youtube', videoId: 'abc123' } as never }),
    );
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('youtube-nocookie.com');
    expect(html).toContain('Guarda il video (YouTube)');
  });
  it('anche nella home il video passa dal pulsante', () => {
    const src = readFileSync('components/home-sections/HomeSectionRenderer.tsx', 'utf8');
    const video = src.slice(src.indexOf("case 'video': {"), src.indexOf("case 'video': {") + 3000);
    expect(video).toContain('<VideoAlClic');
    expect(video).not.toContain('<iframe');
  });
});

describe('357 — «Indietro» sulla copertina del negozio', () => {
  it('chi arriva da fuori va all\'elenco dei negozi invece di non andare da nessuna parte', () => {
    const src = readFileSync('components/store-sections/HeroSection.tsx', 'utf8');
    expect(src).toMatch(/if \(window\.history\.length > 1 && daQuestoSito\) router\.back\(\);\s*else router\.push\('\/stores'\);/);
  });
});

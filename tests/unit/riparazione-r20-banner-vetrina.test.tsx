import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { storeSiteSchema, defaultSite } from '@/lib/store-site';

/**
 * R20-003 — il banner della vetrina usa il testo alternativo scritto dal negozio (non il titolo,
 * che si legge già a video) e con il velo «nessuno» mette una sfumatura sotto la scritta bianca.
 */
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => createElement('img', { alt, src }),
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isError: false }) }));

const { default: BannerSection } = await import('@/components/store-sections/BannerSection');
const ctx = { storeId: 's1', accent: '#C0492C', site: { theme: 'classico', pages: [] } } as never;
const mostra = (config: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(BannerSection, { config: { imageUrl: 'https://x/y.jpg', heading: 'Pane ogni mattina', ...config } as never, ctx }));

describe('R20-003 · banner della vetrina', () => {
  it('il testo alternativo è quello scritto, non il titolo', () => {
    const html = mostra({ alt: 'Il bancone del forno' });
    expect(html).toContain('alt="Il bancone del forno"');
    expect(html).not.toContain('alt="Pane ogni mattina"');
  });

  it('senza testo alternativo la foto è decorativa (alt vuoto), il titolo non si ripete', () => {
    expect(mostra({})).toContain('alt=""');
  });

  it('con il velo «nessuno» c è la sfumatura sotto la scritta', () => {
    expect(mostra({ overlay: 'none' })).toContain('bg-gradient-to-t');
  });

  it('lo schema accetta il banner con e senza alt (siti già salvati)', () => {
    const base = defaultSite();
    const con = (cfg: object) => storeSiteSchema.safeParse({
      ...base,
      pages: [{ ...base.pages[0], sections: [{ id: 'b', type: 'banner', enabled: true, config: cfg }] }],
    });
    const a = con({ imageUrl: 'https://x/y.jpg', alt: 'Il bancone' });
    expect(a.success && (a.data.pages[0].sections[0].config as { alt?: string }).alt).toBe('Il bancone');
    expect(con({ imageUrl: 'https://x/y.jpg' }).success).toBe(true);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { CMS_PAGES } from '@/lib/cms-page';

/**
 * S05 · schede 228, 293, 574, 1592 — blocchi delle pagine CMS e pagine gestite.
 */

vi.mock('next/image', () => ({ default: ({ alt }: { alt?: string }) => createElement('img', { alt: alt ?? '' }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));

async function disegna(sezioni: unknown[]): Promise<string> {
  const { default: Renderer } = await import('@/components/cms/CmsBlockRenderer');
  return renderToStaticMarkup(createElement(Renderer as (p: { sections: unknown[] }) => ReactNode, { sections: sezioni }));
}

describe('blocchi CMS', () => {
  it('228: il banner usa il testo alternativo del pannello, e col velo «nessuno» c’è la sfumatura minima', async () => {
    const html = await disegna([{ id: 'b', type: 'banner', enabled: true,
      config: { imageUrl: 'https://x/foto.jpg', heading: 'Pane ogni mattina', alt: 'Il bancone del forno', overlay: 'none' } }]);
    expect(html).toContain('alt="Il bancone del forno"');
    expect(html).toContain('bg-gradient-to-t');
  });

  it('293: un video «file» caricato dal pannello compare nella pagina', async () => {
    const html = await disegna([{ id: 'v', type: 'video', enabled: true,
      config: { provider: 'file', videoId: '', videoUrl: 'https://x/forno.mp4', heading: 'Il forno' } }]);
    expect(html).toContain('<video');
    expect(html).toContain('src="https://x/forno.mp4"');
  });
});

describe('574: il pannello gestisce solo le pagine che il sito legge davvero', () => {
  it('Termini, Privacy e FAQ non sono più fra le pagine «pubblicabili»', () => {
    expect(CMS_PAGES.map((p) => p.slug)).toEqual(['about']);
    // e /about è davvero l'unica che legge il pannello
    expect(readFileSync('app/about/page.tsx', 'utf8')).toMatch(/loadPublishedCmsPage\('about'\)/);
  });
});

describe('1592: un tipo e un trattino soli', () => {
  it('AvvisoLettura dichiarato una volta, SEGNO_NON_SO è NON_LETTO', async () => {
    const campagne = readFileSync('lib/admin/vista-delle-campagne.ts', 'utf8');
    expect(campagne).not.toMatch(/export interface AvvisoLettura/);
    const { SEGNO_NON_SO } = await import('@/lib/admin/vista-delle-campagne');
    const { NON_LETTO } = await import('@/lib/letture-cruscotto');
    expect(SEGNO_NON_SO).toBe(NON_LETTO);
  });
});

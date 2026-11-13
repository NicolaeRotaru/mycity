// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * R11-025 — Le pagine CMS caricavano ancora YouTube/Vimeo appena aperte, senza
 * un tocco: il browser contattava Google o Vimeo senza consenso. Vetrina e home
 * usavano già VideoAlClic; le pagine CMS no.
 */

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next/image', () => ({ default: () => null }));

import CmsBlockRenderer from '@/components/cms/CmsBlockRenderer';

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; });

describe('R11-025 — video nelle pagine CMS', () => {
  it('nessun iframe esterno finché la persona non tocca il video', async () => {
    const sections = [
      { id: 's1', type: 'video', config: { provider: 'youtube', videoId: 'abc123', heading: 'Il nostro forno' } },
      { id: 's2', type: 'video', config: { provider: 'vimeo', videoId: '987', heading: 'La bottega' } },
    ];
    const r = await disegna(createElement(CmsBlockRenderer, { sections } as never));
    chiudi = r.chiudi;
    expect(r.host.querySelectorAll('iframe'), 'YouTube e Vimeo si caricano senza che nessuno lo chieda').toHaveLength(0);
    const bottone = r.host.querySelector('button') as HTMLButtonElement;
    await act(async () => { bottone.click(); });
    const iframe = r.host.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toContain('youtube-nocookie.com/embed/abc123');
  });
});

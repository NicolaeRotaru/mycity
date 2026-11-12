// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna } from './aiuti/cabina-admin';

/**
 * R02-020 (12/11/2026) — Nella pagina eventi gli stati si leggono in italiano, e un titolo lungo
 * senza spazi va a capo invece di allargare la pagina (sul telefono) o nascondere i pulsanti (sul
 * computer, dove la tabella ora scorre di lato da sola).
 */

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/ImageUrlField', () => ({ ImageUrlField: () => null }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

const LUNGO = '#MercatinoDiNataleInPiazzaCavalli2026';

describe('R02-020 · pagina eventi', () => {
  it('stati in italiano, titolo lungo che va a capo, tabella che scorre di lato', async () => {
    const righe = [
      { id: 'e1', title: LUNGO, description: 'x', cover_image_url: null, starts_at: '2026-12-10T17:00:00Z', ends_at: '2026-12-10T21:00:00Z', discount_percent: null, cta_label: 'Partecipa', cta_url: null, status: 'scheduled' },
      { id: 'e2', title: 'Festa', description: 'x', cover_image_url: null, starts_at: '2026-11-10T17:00:00Z', ends_at: '2026-11-10T21:00:00Z', discount_percent: null, cta_label: 'Partecipa', cta_url: null, status: 'live' },
    ];
    fake.rispondi = (q) => {
      if (q.tabella === 'marketplace_events' && q.op === 'select') return { data: righe, error: null };
      return { data: null, error: null };
    };
    const mod = (await import('@/app/admin/events/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const badge = [...r.host.querySelectorAll('span.rounded-full')].map((b) => b.textContent?.trim());
    expect(badge).toContain('In programma');
    expect(badge).toContain('In corso');
    expect(badge.filter((t) => t && /^(scheduled|live|ended|cancelled)$/.test(t))).toEqual([]);

    const titolo = [...r.host.querySelectorAll('h3')].find((h) => h.textContent === LUNGO)!;
    expect(titolo.className).toMatch(/min-w-0/);
    expect(titolo.className).toMatch(/break-words|overflow-wrap/);
    const tabella = r.host.querySelector('table')!.parentElement!;
    expect(tabella.className).toMatch(/overflow-x-auto/);
    expect(tabella.className).not.toMatch(/overflow-hidden/);
  });
});

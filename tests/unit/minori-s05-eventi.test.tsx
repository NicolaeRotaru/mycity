// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { fake, disegna, aspetta, scrivi, type Domanda } from './aiuti/cabina-admin';
import { campoDataOraPiacenza, istanteDaCampoPiacenza } from '@/lib/admin/etichette';

/**
 * S05 · schede 152, 350, 364, 296 (eventi) — pagina Eventi dell'admin.
 */

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/ImageUrlField', () => ({ ImageUrlField: () => null }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

const EVENTO = {
  id: 'e1', title: 'Mercatino', description: 'Di Natale', cover_image_url: null,
  starts_at: '2026-11-10T17:00:00+00:00', ends_at: '2026-07-10T19:00:00+00:00',
  discount_percent: null, cta_label: 'Partecipa', cta_url: null, status: 'scheduled',
};

async function apri(rispondi: (q: Domanda) => { data: unknown; error: unknown }) {
  fake.rispondi = rispondi;
  const mod = (await import('@/app/admin/events/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('ora di Piacenza nei campi', () => {
  it('152: database → campo → salvato dà lo stesso istante, d’inverno e d’estate', () => {
    for (const iso of ['2026-11-10T17:00:00.000Z', '2026-07-10T16:30:00.000Z', '2027-03-28T00:30:00.000Z']) {
      const campo = campoDataOraPiacenza(iso);
      expect(istanteDaCampoPiacenza(campo)?.toISOString(), `${iso} → ${campo}`).toBe(iso);
    }
    expect(campoDataOraPiacenza('2026-11-10T17:00:00+00:00')).toBe('2026-11-10T18:00');
    expect(campoDataOraPiacenza('2026-07-10T16:30:00Z')).toBe('2026-07-10T18:30');
  });

  it('152: «Modifica» mette nel campo le 18:00 di Piacenza e il salvataggio non sposta l’orario', async () => {
    const host = await apri((q) => (q.tabella === 'marketplace_events' && q.op === 'select'
      ? { data: [{ ...EVENTO, ends_at: '2026-11-10T21:00:00+00:00' }], error: null }
      : { data: null, error: null }));
    const modifica = host.querySelector('button[aria-label*="odifica"], button[title*="odifica"]') as HTMLButtonElement
      ?? [...host.querySelectorAll('button')].find((b) => /Modifica/.test(b.textContent ?? '') || /odific/.test(b.getAttribute('aria-label') ?? ''));
    await act(async () => { modifica?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await aspetta();
    const campi = [...document.querySelectorAll('input[type="datetime-local"]')] as HTMLInputElement[];
    expect(campi[0]?.value).toBe('2026-11-10T18:00');
    const form = document.getElementById('event-form') as HTMLFormElement;
    await act(async () => { form.requestSubmit(); });
    await aspetta();
    const scritta = fake.domande.find((d) => d.op === 'update' && d.tabella === 'marketplace_events');
    expect((scritta?.valori as { starts_at: string }).starts_at).toBe('2026-11-10T17:00:00.000Z');
  });
});

describe('pagina eventi', () => {
  it('296: lettura caduta → avviso con «Riprova», non «Nessun evento.»', async () => {
    const host = await apri(() => ({ data: null, error: { message: 'giù' } }));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Nessun evento.');
  });

  it('364: il campo del link accetta il percorso interno che suggerisce', async () => {
    const host = await apri(() => ({ data: [], error: null }));
    const nuovo = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Nuovo evento'));
    await act(async () => { nuovo?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await aspetta();
    const link = [...document.querySelectorAll('input')].find((i) => i.placeholder.startsWith('/search')) as HTMLInputElement;
    expect(link.type).not.toBe('url');
    await scrivi(link, '/search?event=natale');
    expect(link.checkValidity()).toBe(true);
  });

  it('350: la conferma di eliminazione non promette avvisi che non partono', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('app/admin/events/page.tsx', 'utf8')).not.toMatch(/verranno notificati/);
  });
});

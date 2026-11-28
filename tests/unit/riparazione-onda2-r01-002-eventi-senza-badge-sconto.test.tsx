/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';
import { fake, disegna } from './aiuti/cabina-admin';

/**
 * R01-002 (onda 2) — Lo sconto scritto su un evento appariva ai clienti come «-20%» sulla copertina
 * di /events, ma nessun calcolo del prezzo lo applica (lib/ordini/prezzi.ts): il cliente pagava il
 * prezzo pieno. Un prezzo ridotto annunciato e non praticato è una pratica commerciale ingannevole
 * (Codice del Consumo, art. 21-22). La pagina non mostra più il badge; l'avviso dell'admin non dice
 * più che i clienti possono vederlo.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('@/components/ImageUrlField', () => ({ ImageUrlField: () => null }));

const g = globalThis as Record<string, unknown>;

let chiudi: (() => void) | null = null;
afterEach(() => {
  chiudi?.();
  chiudi = null;
  fake.azzera();
  delete g.__DATI_QUERY__;
  document.body.innerHTML = '';
});

describe('R01-002 · la pagina Eventi non promette uno sconto che la cassa non applica', () => {
  it('un evento con discount_percent 20 e la copertina non mostra «-20%»', async () => {
    const domani = new Date(Date.now() + 86_400_000).toISOString();
    const dopodomani = new Date(Date.now() + 2 * 86_400_000).toISOString();
    g.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (o.queryKey[1] === 'public'
      ? [{
          id: 'ev1', title: 'Mercatino di Natale', description: 'In piazza Cavalli',
          cover_image_url: 'https://example.com/mercatino.jpg',
          starts_at: domani, ends_at: dopodomani, discount_percent: 20,
          cta_label: 'Partecipa', cta_url: null, status: 'scheduled', sponsor_seller_id: null, sponsor: null,
        }]
      : {});
    const mod = await monta('app/events/page.tsx');
    const s = accendi(mod.default);
    await attendi();
    const testo = testoVisibile(s.radice);
    expect(testo).toContain('Mercatino di Natale');
    expect(testo).not.toMatch(/-\s*20\s*%/);
    s.smonta();
  });

  it('l\'avviso dell\'admin non dice più che lo sconto può comparire ai clienti', async () => {
    fake.rispondi = (q) => (q.tabella === 'marketplace_events' && q.op === 'select'
      ? { data: [{
          id: 'e1', title: 'Mercatino', description: 'Di Natale', cover_image_url: null,
          starts_at: '2026-12-10T17:00:00+00:00', ends_at: '2026-12-10T21:00:00+00:00',
          discount_percent: 20, cta_label: 'Partecipa', cta_url: null, status: 'scheduled',
        }], error: null }
      : { data: null, error: null });
    const mod = (await import('@/app/admin/events/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const avviso = [...r.host.querySelectorAll('[role="note"]')].map((n) => n.textContent ?? '').join(' ');
    expect(avviso).toMatch(/20%/);
    expect(avviso).not.toMatch(/può comparire/);
    expect(avviso).toMatch(/non lo mostra/);
  });
});

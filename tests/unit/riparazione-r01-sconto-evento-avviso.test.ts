// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna } from './aiuti/cabina-admin';

/**
 * R01-002 (27/11/2026) — Il modulo eventi non salva più lo sconto, ma gli eventi salvati prima lo
 * tengono: la pagina Eventi può mostrarlo ai clienti come «-20%», e la cassa non lo applica. L'elenco
 * dell'admin deve dirlo, evento per evento; un evento senza sconto non porta nessun avviso.
 */

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/ImageUrlField', () => ({ ImageUrlField: () => null }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

const base = {
  description: 'Descrizione', cover_image_url: 'https://example.test/c.jpg',
  starts_at: '2026-12-10T17:00:00+00:00', ends_at: '2026-12-10T21:00:00+00:00',
  cta_label: 'Partecipa', cta_url: null, status: 'scheduled', sponsor_seller_id: null,
};
const CON_SCONTO = { ...base, id: 'e1', title: 'Mercatino di Natale', discount_percent: 20 };
const SENZA_SCONTO = { ...base, id: 'e2', title: 'Festa di quartiere', discount_percent: null };
const SCONTO_ZERO = { ...base, id: 'e3', title: 'Concerto in piazza', discount_percent: 0 };

async function apriElenco(): Promise<HTMLElement> {
  fake.rispondi = (q) => (q.tabella === 'marketplace_events' && q.op === 'select'
    ? { data: [CON_SCONTO, SENZA_SCONTO, SCONTO_ZERO], error: null }
    : { data: null, error: null });
  const mod = (await import('@/app/admin/events/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('R01-002 · l\'elenco eventi avvisa l\'admin dello sconto rimasto salvato', () => {
  it('la riga dell\'evento con lo sconto salvato dice «20%» e che la cassa non lo applica', async () => {
    const host = await apriElenco();
    const riga = [...host.querySelectorAll('tr')].find((tr) => tr.textContent?.includes('Mercatino di Natale'));
    expect(riga, 'la riga dell\'evento deve esserci').toBeTruthy();
    expect(riga!.textContent).toMatch(/20%/);
    expect(riga!.textContent).toMatch(/la cassa non lo applica/);
  });

  it('anche la scheda del telefono porta l\'avviso, e solo per l\'evento con lo sconto', async () => {
    const host = await apriElenco();
    const avvisi = [...host.querySelectorAll('[role="note"]')].filter((n) => /la cassa non lo applica/.test(n.textContent ?? ''));
    // tabella (computer) + scheda (telefono): due avvisi, tutti e due sull'evento da 20%.
    expect(avvisi).toHaveLength(2);
    for (const a of avvisi) expect(a.textContent).toMatch(/20%/);
    const righe = [...host.querySelectorAll('tr')];
    for (const titolo of ['Festa di quartiere', 'Concerto in piazza']) {
      const riga = righe.find((tr) => tr.textContent?.includes(titolo));
      expect(riga, titolo).toBeTruthy();
      expect(riga!.textContent).not.toMatch(/sconto|%/i);
    }
  });
});

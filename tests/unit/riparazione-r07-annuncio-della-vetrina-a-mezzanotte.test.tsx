/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R07-003 — Una vetrina lasciata aperta oltre mezzanotte continuava a mostrare l'annuncio del giorno
 * prima finché la pagina non si ridisegnava: «Chiusi per ferie fino al 24/11» restava lì anche il 25.
 * L'annuncio si decideva al disegno; ora il giorno di Piacenza si ricontrolla ogni minuto.
 *
 * Orologio finto: 24/11/2026 alle 23:58 a Piacenza (22:58 UTC, ora solare).
 */
vi.mock('react', async (o) => ({ ...(await o<Record<string, unknown>>()), use: () => ({ id: 'negozio-1' }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: null }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/analytics/events', () => ({ trackStoreViewed: () => undefined }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('@/components/products/VendutoDa', () => ({ VendutoDa: () => null }));
vi.mock('@/components/Segnala', () => ({ Segnala: () => null }));
vi.mock('@/components/store-sections/SectionRenderer', () => ({ default: () => null }));
vi.mock('@/components/store-sections/StoreNav', () => ({ default: () => null }));
vi.mock('@/components/store-sections/ScheletroNegozio', () => ({ default: () => null }));
vi.mock('@/components/ui/Breadcrumb', () => ({ Breadcrumb: () => null }));
vi.mock('@/components/store-sections/useStorePageData', () => {
  const store = { id: 'negozio-1', store_name: 'Forno Rossi', is_approved: true, store_hours: null, store_address: 'Via Roma 1' };
  const dati = {
    isLoading: false, isError: false, approved: true, store,
    custom: { announcement: { enabled: true, text: 'Chiusi per ferie fino al 24 novembre', until: '2026-11-24' } },
    accent: '#C0492C', socials: [], site: { theme: 'classico', pages: [] },
    ctx: { reviews: [], riepilogoRecensioni: null, store },
    refetch: () => undefined,
  };
  return { useStorePageData: () => dati };
});
vi.mock('@/lib/store-site', () => ({ homePage: () => ({ sections: [] }), enabledSections: () => [] }));

import StorePage from '@/app/store/[id]/page';

let root: Root | null = null;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-11-24T22:58:00Z'));
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

async function apriLaVetrina() {
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  root = createRoot(radice);
  await act(async () => { root!.render(createElement(StorePage, { params: Promise.resolve({ id: 'negozio-1' }) })); });
  return radice;
}

describe('R07-003 · l annuncio della vetrina si spegne a mezzanotte anche con la pagina aperta', () => {
  it('alle 23:58 del 24 l annuncio «fino al 24» c è; tre minuti dopo, il 25, non c è più', async () => {
    const radice = await apriLaVetrina();
    expect(radice.textContent).toContain('Chiusi per ferie fino al 24 novembre');

    await act(async () => { vi.advanceTimersByTime(3 * 60_000); });

    expect(radice.textContent, 'dopo mezzanotte la vetrina aperta mostra ancora l annuncio di ieri').not.toContain('Chiusi per ferie');
  });

  it('prima di mezzanotte l annuncio resta', async () => {
    const radice = await apriLaVetrina();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(radice.textContent).toContain('Chiusi per ferie fino al 24 novembre');
  });
});

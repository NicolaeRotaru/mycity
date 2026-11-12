import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { orariPerLoSchema } from '@/components/store-sections/orari-schema';

/**
 * R07-022 (12/11/2026) — orari, stelle e indirizzo web del negozio non arrivavano a Google
 * nella prima lettura. Indirizzo (url) e stelle: a posto (dominio pubblico; stelle col
 * precarico di R07-021). Gli orari mancavano del tutto dallo schema: ora la pagina li scrive
 * come `openingHoursSpecification`, dagli store_hours che arrivano col negozio.
 */
const DATI = vi.hoisted(() => ({
  orari: { mon: [['08:00', '12:30'], ['16:00', '19:30']], tue: [['08:00', '12:30']], wed: [], thu: [], fri: [], sat: [], sun: [] } as unknown,
}));

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
vi.mock('@/components/store-sections/useStorePageData', () => ({
  useStorePageData: () => {
    const store = { id: 'negozio-1', store_name: 'Forno Rossi', is_approved: true, store_hours: DATI.orari, store_address: 'Via Roma 1' };
    return {
      isLoading: false, isError: false, approved: true, store,
      custom: {}, accent: '#C0492C', socials: [], site: { theme: 'classico', pages: [] },
      ctx: { reviews: [], riepilogoRecensioni: { media: 4.5, totale: 12 }, store },
      refetch: () => undefined,
    };
  },
}));
vi.mock('@/lib/store-site', () => ({ homePage: () => ({ sections: [] }), enabledSections: () => [] }));
vi.mock('@/lib/store-customization', () => ({ announcementActive: () => false }));

import StorePage from '@/app/store/[id]/page';

function schema(): Record<string, unknown> {
  const html = renderToString(createElement(StorePage, { params: Promise.resolve({ id: 'negozio-1' }) }));
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  expect(m, 'lo schema per Google non c è').not.toBeNull();
  return JSON.parse(m![1]);
}

describe('R07-022 · gli orari del negozio arrivano a Google nella prima lettura', () => {
  it('lo schema disegnato dal server ha gli orari, le stelle e l indirizzo della pagina', () => {
    const s = schema();
    const orari = s.openingHoursSpecification as Array<Record<string, string>>;
    expect(orari).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Monday', opens: '08:00', closes: '12:30' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Monday', opens: '16:00', closes: '19:30' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Tuesday', opens: '08:00', closes: '12:30' },
    ]);
    expect((s.aggregateRating as Record<string, unknown>).reviewCount).toBe(12);
    expect(String(s.url)).toMatch(/\/store\/negozio-1$/);
  });

  it('orari mai scritti: niente orari nello schema (non «sempre chiuso»)', () => {
    expect(orariPerLoSchema(null)).toBeUndefined();
    expect(orariPerLoSchema({ mon: [] })).toBeUndefined();
  });
});

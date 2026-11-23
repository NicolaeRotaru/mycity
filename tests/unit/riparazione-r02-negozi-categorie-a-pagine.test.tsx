/**
 * @vitest-environment jsdom
 */
/**
 * R02-009 (onda 9) — LA PAGINA DEI NEGOZI LEGGE TUTTE LE CATEGORIE, NON LE PRIME MILLE.
 *
 * `app/stores/page.tsx` chiedeva le categorie senza `.range()`: il servizio dati ne restituisce al
 * massimo mille per domanda (max_rows) e non lo dice. Ordinate per nome, una madre dopo la
 * millesima riga («Zucchero e dolci») spariva dai bottoni del filtro, e il negozio che vende solo
 * nella sua figlia non si trovava più col filtro della madre.
 *
 * Qui il finto PostgREST taglia a mille come quello vero; l'albero ha 1.103 categorie. La pagina si
 * monta col react-query vero: la lettura dei dati gira davvero.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { creaPostgrestColTetto, type Riga } from './aiuti/riparazione-r06-postgrest-col-tetto';

const categorie: Riga[] = [
  { id: 'm-ali', slug: 'alimentari', name: 'Alimentari', parent_id: null, icon: null },
  ...Array.from({ length: 1100 }, (_, i) => {
    const n = String(i + 1).padStart(4, '0');
    return { id: `f-ali-${n}`, slug: `alimentari-${n}`, name: `Alimentari voce ${n}`, parent_id: 'm-ali', icon: null };
  }),
  { id: 'f-zuc', slug: 'zucchero-di-canna', name: 'Zucchero di canna', parent_id: 'm-zuc', icon: null },
  { id: 'm-zuc', slug: 'zucchero-e-dolci', name: 'Zucchero e dolci', parent_id: null, icon: null },
];

const negozio = {
  id: 'n1', store_name: 'Forno Mattutino', store_phone: null, store_address: 'Via Roma 1', store_lat: null, store_lng: null,
  store_logo: null, store_hours: null, store_media: null, is_approved: true, stripe_charges_enabled: true, stripe_payouts_enabled: true,
};

const pg = creaPostgrestColTetto({ categories: categorie, seller_public_profiles: [negozio] });

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => pg.client.from(t),
    rpc: (nome: string) => {
      const risposta = async () => {
        if (nome === 'store_cards') return { data: [{ seller_id: 'n1', prodotti: [], totale: 3 }], error: null };
        if (nome === 'categorie_per_negozio') return { data: [{ seller_id: 'n1', categorie: ['f-zuc'] }], error: null };
        return { data: [], error: null };
      };
      // R12-012 — la pagina legge categorie_per_negozio a finestre (`.order().range()`), come il client vero.
      const q: Record<string, unknown> = {
        order: () => q,
        range: () => q,
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => risposta().then(ok, ko),
      };
      return q;
    },
  },
}));
vi.mock('@/components/StorePreviewCard', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: { store: { store_name: string } }) => ce('article', null, p.store.store_name) };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

import StoresPage from '@/app/stores/page';

describe('R02-009 — le categorie della pagina dei negozi oltre la millesima riga', () => {
  it('la madre che per nome viene dopo la millesima categoria c\'è fra i filtri, e trova il suo negozio', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(StoresPage)));
    });
    for (let i = 0; i < 20 && !radice.textContent?.includes('Tutti i settori'); i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    }
    const bottoni = () => [...radice.querySelectorAll('button')];
    expect(bottoni().some((b) => b.textContent?.trim() === 'Alimentari'), 'controprova: i filtri delle categorie si disegnano').toBe(true);

    const zucchero = bottoni().find((b) => b.textContent?.trim() === 'Zucchero e dolci');
    expect(zucchero, 'la madre dopo la millesima riga manca dai filtri: la lettura si è fermata a mille').toBeTruthy();

    await act(async () => { zucchero!.click(); });
    expect(radice.textContent, 'col filtro della madre il negozio che vende nella figlia deve esserci').toContain('Forno Mattutino');

    const lettureCategorie = pg.richieste.filter((r) => r.tabella === 'categories');
    expect(lettureCategorie.every((r) => r.finestra !== null), 'ogni lettura delle categorie chiede una finestra').toBe(true);
    act(() => root.unmount());
  }, 60000);
});

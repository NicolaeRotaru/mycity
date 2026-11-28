/**
 * ARMONIA NASCOSTA nella pagina del negozio (Nicola, 28/11/2026: primo passo del piano). Ogni negozio ha la
 * sua firma, calcolata dal nome e dal giorno d'iscrizione a Piacenza: la stessa della bozza del suo sito.
 * Senza foto di copertina, nel fondo colorato compare la trama della firma, nella parte alta; sopra una
 * foto non si mette niente.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { firmaDi, giornoAPiacenza } from '@/lib/armonia';

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: () => {}, push: () => {} }), usePathname: () => '/' }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/StoreStoryRing', () => ({ default: () => null }));
vi.mock('@/components/StoreMediaCarousel', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));

// Iscritto alle 00:30 del 23/10/2026 a Piacenza, che in UTC è ancora il 22/10. Lo Scorpione entra il 23/10
// alle 11:39: col giorno di Piacenza la firma è Scorpione (acqua), col giorno UTC sarebbe Bilancia (aria).
const NEGOZIO = {
  id: 'n1',
  store_name: 'Pane Quotidiano',
  store_phone: null,
  store_address: null,
  store_lat: null,
  store_lng: null,
  is_approved: true,
  store_logo: null,
  store_hours: null,
  store_media: [] as unknown[],
  store_description: null,
  founded_year: null,
  created_at: '2026-10-22T22:30:00Z',
};

async function vetrina(store: typeof NEGOZIO): Promise<string> {
  const { default: HeroSection } = await import('@/components/store-sections/HeroSection');
  const ctx = { storeId: store.id, store, customization: {}, accent: '#7C8B5A', reviews: [], promos: [], site: { sections: [] } };
  return renderToStaticMarkup(createElement(HeroSection as never, { config: {}, ctx }));
}

describe('la vetrina del negozio nasce dalla sua firma', () => {
  it('ha la firma del suo negozio, col giorno d\'iscrizione di Piacenza: la stessa della bozza del sito', async () => {
    expect(giornoAPiacenza(new Date(NEGOZIO.created_at))).toBe('2026-10-23');
    const f = firmaDi({ nome: 'Pane Quotidiano', data: '2026-10-23' });
    expect(f.elemento).toBe('acqua');
    const html = await vetrina(NEGOZIO);
    expect(html).toContain(`data-armonia-numero="${f.numero}"`);
    expect(html).toContain('--armonia-raggio:999px');
    expect(html).toContain(`--armonia-durata:${f.durata}ms`);
  });

  it('senza foto di copertina la trama sta nella parte alta, che sfuma prima del nome', async () => {
    const html = await vetrina(NEGOZIO);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-armonia="[a-z-]+"/);
    expect(html).toContain('mask-image:linear-gradient(to bottom, #000 0%, #000 30%, transparent 62%)');
  });

  it('sopra una foto di copertina non si mette niente', async () => {
    const html = await vetrina({ ...NEGOZIO, store_media: [{ type: 'image', url: 'https://example.com/copertina.jpg' }] });
    expect(html).not.toContain('data-armonia="');
    expect(html).toContain('data-armonia-numero=');
  });
});

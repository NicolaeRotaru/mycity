import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newSection, storeSiteSchema, defaultSite, type SiteSection } from '@/lib/store-site';

/**
 * R04 — Nel blocco di testo di una pagina del negozio il campo aveva maxLength={4000}: il testo
 * incollato oltre i 4.000 caratteri si tagliava in silenzio. Chi scrive deve vederlo prima: il
 * testo resta intero, un contatore dice quanto ne ha usato, oltre il limite un errore lo dice.
 */

vi.mock('@/components/ImageUrlField', () => ({ ImageUrlField: () => null }));
vi.mock('@/lib/supabase/client', () => import('./aiuti/finti/supabase-client.mjs'));

const { default: Modulo } = await import('@/components/seller/site/SectionConfigForm');

function disegna(body: string): string {
  const base = newSection('richText');
  const sezione = { ...base, config: { ...(base.config as object), body } } as SiteSection;
  return renderToStaticMarkup(createElement(Modulo, { section: sezione, onChange: () => {} }));
}

describe('R04 — il testo lungo della pagina negozio non si taglia in silenzio', () => {
  it('il campo non ha un tetto che il browser applica da solo, e il testo resta intero', () => {
    const html = disegna('a'.repeat(4500));
    const area = html.match(/<textarea[^>]*>/)?.[0] ?? '';
    expect(area, 'il browser taglia il testo incollato oltre il tetto').not.toMatch(/maxlength=/i);
    expect(html).toContain('a'.repeat(4500));
  });

  it('oltre il limite il modulo lo dice prima del salvataggio', () => {
    const html = disegna('a'.repeat(4500));
    expect(html).toMatch(/Il testo è troppo lungo/);
    expect(html).toMatch(/aria-invalid="true"/);
  });

  it('dentro il limite: il contatore e nessun errore', () => {
    const html = disegna('ciao');
    expect(html).toMatch(/4\/4\.?000 caratteri/);
    expect(html).not.toMatch(/troppo lungo/);
  });

  it('il contatore conta come lo schema: un testo che il salvataggio rifiuta il modulo lo segnala', () => {
    // 3.990 lettere e 5 a-capo: nel campo sono 3.995 segni, salvati sono 4.005 (ogni a-capo è «<br>»).
    const body = `${'a'.repeat(3990)}${'<br>'.repeat(5)}`;
    const site = defaultSite();
    const base = newSection('richText');
    const conTesto = { ...site, pages: [{ ...site.pages[0], sections: [{ ...base, config: { ...(base.config as object), body } }] }] };
    expect(storeSiteSchema.safeParse(conTesto).success, 'controprova: il salvataggio lo rifiuta').toBe(false);
    expect(disegna(body)).toMatch(/Il testo è troppo lungo/);
  });
});

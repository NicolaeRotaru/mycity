import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newHomeSection, homeSectionSchema, RICHTEXT_MAX, leggiHomeSite } from '@/lib/home-site';
import { sanitizeRichText } from '@/lib/sanitize-html';

/**
 * R10-014 — Nel blocco di testo di una pagina del sito (home o pagine CMS) il
 * campo aveva maxLength={4000}: un testo incollato più lungo veniva tagliato
 * dal browser senza avvisare, e la pagina pubblicata restava monca.
 */

vi.mock('@/components/ImageUrlField', () => ({ ImageUrlField: () => null }));

const { default: Modulo } = await import('@/components/admin/home/HomeSectionConfigForm');

function disegna(body: string): string {
  const base = newHomeSection('richText');
  const sezione = { ...base, config: { ...(base.config as object), body } } as typeof base;
  return renderToStaticMarkup(createElement(Modulo, { section: sezione, onChange: () => {} }));
}

describe('R10-014 — un testo lungo non si taglia in silenzio', () => {
  it('il campo non ha un tetto che il browser applica da solo', () => {
    const html = disegna('a'.repeat(4500));
    const area = html.match(/<textarea[^>]*>/)?.[0] ?? '';
    expect(area, 'il browser taglia il testo incollato oltre il tetto').not.toMatch(/maxlength=/i);
    expect(html).toContain('a'.repeat(4500));
  });

  it('oltre il limite il modulo lo dice', () => {
    const html = disegna('a'.repeat(4500));
    expect(html).toMatch(/Il testo è troppo lungo/);
    expect(html).toMatch(/aria-invalid="true"/);
  });

  it('dentro il limite: il contatore e nessun errore', () => {
    const html = disegna('ciao');
    expect(html).toMatch(/4\/4\.?000 caratteri/);
    expect(html).not.toMatch(/troppo lungo/);
  });

  it('il contatore conta il testo come lo schema, non i tag di un link', () => {
    const html = disegna('<a href="https://example.com/pagina">ciao</a>');
    expect(html, 'il contatore conta anche i tag: diverso dal limite che applica il salvataggio').toMatch(/4\/4\.?000 caratteri/);
  });

  it('il salvataggio rifiuta con un messaggio che dice il limite', () => {
    const base = newHomeSection('richText');
    const r = homeSectionSchema.safeParse({ ...base, config: { ...(base.config as object), body: 'a'.repeat(RICHTEXT_MAX + 1) } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/al massimo 4\.?000 caratteri/);
  });

  it('un testo dentro il limite, con link e «<», sopravvive alla sanitizzazione e alla rilettura', () => {
    const link = '<a href="https://example.com/una-pagina">vedi qui</a> ';
    const body = (link + 'a < b e c > d. ').repeat(80).slice(0, 3900);
    const base = newHomeSection('richText');
    const sezione = { ...base, config: { ...(base.config as object), body } };
    expect(homeSectionSchema.safeParse(sezione).success, 'controprova: il testo scritto passa').toBe(true);
    const salvata = { ...sezione, config: { ...sezione.config, body: sanitizeRichText(body) } };
    expect(salvata.config.body.length, 'controprova: la sanitizzazione allunga davvero').toBeGreaterThan(RICHTEXT_MAX);
    const { site, scartate } = leggiHomeSite({ version: 1, sections: [salvata] });
    expect(scartate, 'il blocco salvato sparisce alla rilettura').toEqual([]);
    expect(site.sections).toHaveLength(1);
  });
});

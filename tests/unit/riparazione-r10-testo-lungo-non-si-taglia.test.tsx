import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newHomeSection, homeSectionSchema, RICHTEXT_MAX } from '@/lib/home-site';

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

  it('il salvataggio rifiuta con un messaggio che dice il limite', () => {
    const base = newHomeSection('richText');
    const r = homeSectionSchema.safeParse({ ...base, config: { ...(base.config as object), body: 'a'.repeat(RICHTEXT_MAX + 1) } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/al massimo 4\.?000 caratteri/);
  });
});

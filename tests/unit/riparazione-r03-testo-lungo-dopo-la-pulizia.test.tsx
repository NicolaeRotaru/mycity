import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newSection, normalizeSite, storeSiteSchema, defaultSite, type SiteSection } from '@/lib/store-site';
import { sanitizeRichText } from '@/lib/sanitize-html';

/**
 * 17/11/2026 — IL TESTO LUNGO DELLA VETRINA, CONTATO PRIMA DELLA PULIZIA.
 *
 * Il contatore del blocco di testo contava il testo come lo scrive il negoziante. Ma la rotta che
 * salva lo pulisce (sanitizeRichText: «&» diventa «&amp;», «<» diventa «&lt;») e alla rilettura il
 * limite dei 4.000 caratteri si ricontrolla sul testo pulito: 3.980 «a» più « Tom & Jerry < 3 »
 * sono 3.997 caratteri per il contatore e 4.003 dopo la pulizia. Il modulo diceva «va bene», il
 * sito si salvava, e alla rilettura tornava la vetrina di partenza: spariti blocchi, pagine, menu.
 * Qui il modulo vero si disegna con quel testo e deve dire che è troppo lungo.
 */

vi.mock('@/components/ImageUrlField', () => ({ ImageUrlField: () => null }));
vi.mock('@/lib/supabase/client', () => import('./aiuti/finti/supabase-client.mjs'));

const { default: Modulo } = await import('@/components/seller/site/SectionConfigForm');

const sezioneCon = (body: string) => {
  const base = newSection('richText');
  return { ...base, config: { ...(base.config as object), body } } as SiteSection;
};
const disegna = (body: string) => renderToStaticMarkup(createElement(Modulo, { section: sezioneCon(body), onChange: () => {} }));
const sitoCon = (body: string) => {
  const site = defaultSite();
  return { ...site, pages: [{ ...site.pages[0], sections: [sezioneCon(body)] }] };
};

const VICINO_AL_LIMITE = `${'a'.repeat(3980)} Tom & Jerry < 3 `;

describe('il contatore del testo della vetrina conta come conterà il server', () => {
  it('il caso è vero: 3.997 caratteri prima della pulizia, 4.003 dopo, e alla rilettura il sito sparirebbe', () => {
    expect(VICINO_AL_LIMITE.length).toBe(3997);
    expect(sanitizeRichText(VICINO_AL_LIMITE).length).toBe(4003);
    expect(storeSiteSchema.safeParse(sitoCon(VICINO_AL_LIMITE)).success, 'prima della pulizia lo schema lo accetta').toBe(true);
    const salvato = sitoCon(sanitizeRichText(VICINO_AL_LIMITE));
    expect(normalizeSite(salvato).pages[0].sections, 'la rilettura del testo pulito ripiega sulla vetrina di partenza').not.toEqual(salvato.pages[0].sections);
  });

  it('3.997 caratteri con «&» e «<»: il modulo dice che è troppo lungo, con il conto di dopo la pulizia', () => {
    const html = disegna(VICINO_AL_LIMITE);
    expect(html, 'il modulo dice «va bene» a un testo che il server salva oltre il limite').toMatch(/Il testo è troppo lungo: 4\.?003 caratteri su 4\.?000/);
    expect(html).toMatch(/aria-invalid="true"/);
  });

  it('controprova: 3.997 lettere senza segni da pulire restano dentro il limite', () => {
    const html = disegna('a'.repeat(3997));
    expect(html).toMatch(/3\.?997\/4\.?000 caratteri/);
    expect(html).not.toMatch(/troppo lungo/);
  });

  it('un testo breve con «&» e «<» si conta come verrà salvato', () => {
    const testo = 'Pane & vino < 3 euro';
    expect(sanitizeRichText(testo)).toBe('Pane &amp; vino &lt; 3 euro');
    const html = disegna(testo);
    expect(html).toMatch(/27\/4\.?000 caratteri/);
    expect(html).not.toMatch(/troppo lungo/);
  });
});

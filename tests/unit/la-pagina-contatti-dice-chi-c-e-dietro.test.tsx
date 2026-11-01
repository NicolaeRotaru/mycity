/**
 * 01/11/2026 (ondata 5) — LA PAGINA CONTATTI DICEVA «SEDE: MYCITY» E BASTA.
 *
 * Il riquadro in cima alla colonna laterale di /contact stampava solo la
 * denominazione (ripiego «MyCity», un marchio) e niente altro: nessuna persona,
 * nessun indirizzo, e nessuna frase che dicesse che l'indirizzo manca.
 * Queste prove leggono SOLO la riga principale del riquadro (il primo <p>),
 * non la riga piccola di identità sotto.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}));

import ContactPage from '@/app/contact/page';

function rigaPrincipaleDelRiquadro(): string {
  const html = renderToStaticMarkup(createElement(ContactPage));
  const aside = html.match(/<aside[^>]*>([\s\S]*)<\/aside>/);
  expect(aside, 'la colonna laterale non c\'e\'').not.toBeNull();
  const primoP = aside![1].match(/<p[^>]*>([\s\S]*?)<\/p>/);
  expect(primoP, 'il riquadro chi-siamo non ha la riga principale').not.toBeNull();
  return primoP![1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('pagina contatti: chi c\'e\' dietro MyCity', () => {
  it('senza nome legale nomina la persona che gestisce, non il solo marchio', () => {
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_NOME', '');
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_INDIRIZZO', '');
    const riga = rigaPrincipaleDelRiquadro();
    expect(riga).toContain('Nicolae Rotaru');
    expect(riga).not.toMatch(/^MyCity$/);
  });

  it('se manca l\'indirizzo della sede lo dice, invece di lasciare il vuoto', () => {
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_NOME', '');
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_INDIRIZZO', '');
    expect(rigaPrincipaleDelRiquadro()).toMatch(/non ancora pubblicat/i);
  });

  it('con indirizzo e nome legale veri stampa quelli, senza la frase del vuoto', () => {
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_NOME', 'MyCity S.r.l.');
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_INDIRIZZO', 'Via Esempio 3, Piacenza');
    const riga = rigaPrincipaleDelRiquadro();
    expect(riga).toContain('MyCity S.r.l.');
    expect(riga).toContain('Via Esempio 3, Piacenza');
    expect(riga).not.toMatch(/non ancora pubblicat/i);
  });
});

/**
 * @vitest-environment jsdom
 *
 * 28/10/2026 — ondata 10, pacchetto «lib/promesse-pubbliche.ts», seconda bocciatura del collaudo.
 *
 * Il primo giro aveva tolto i «30-60 minuti» dall'hero e dai punti di fiducia della home, come
 * deciso da Nicola il 26/10: «in giornata», niente minuti. Ma la sezione «Come funziona, in 3
 * passi» — accesa nella home di default e ripetuta su /come-funziona — scriveva ancora a mano
 * «Te lo portiamo a casa in 30-60 minuti.». Al lancio si consegna in bici, solo negli orari del
 * negozio: un cliente che ordina alle 19:50 non riceve niente in un'ora.
 *
 * La prova rende il componente VERO e guarda il testo che la persona legge.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HowItWorks from '@/components/home/HowItWorks';
import { defaultHomeSite, homeEnabledSections } from '@/lib/home-site';

function testoDeiTrePassi(): string {
  const html = renderToStaticMarkup(createElement(HowItWorks));
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('«Come funziona, in 3 passi» promette quello che la consegna mantiene', () => {
  it('la sezione è accesa nella home di default (altrimenti la prova sotto non conta)', () => {
    const tipi = homeEnabledSections(defaultHomeSite()).map((s) => s.type);
    expect(tipi).toContain('howItWorks');
  });

  it('non promette una stima a minuti', () => {
    const testo = testoDeiTrePassi();
    expect(testo).not.toMatch(/\d+\s*[-–]\s*\d+\s*min/i);
    expect(testo).not.toMatch(/minut/i);
  });

  it('dice la regola vera: in giornata, negli orari di apertura del negozio', () => {
    const testo = testoDeiTrePassi();
    expect(testo).toMatch(/in giornata, negli orari di apertura del negozio/);
  });
});

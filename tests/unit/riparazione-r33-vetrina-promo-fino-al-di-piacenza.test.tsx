/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PromotionsSection from '@/components/store-sections/PromotionsSection';
import type { SectionContext } from '@/components/store-sections/SectionContext';

/**
 * R33-022 — La vetrina del negozio scriveva «fino al» con toLocaleDateString senza fuso: la promo
 * «Oggi» del 6/11 finisce alle 23:59:59.999 di Piacenza (22:59:59.999Z), e da un telefono a est di
 * Roma si leggeva «fino al 7/11». La data della vetrina è quella di Piacenza, da qualunque fuso la
 * si guardi, anche nei giorni del cambio d'ora.
 */

const fusoDiPrima = process.env.TZ;
afterEach(() => { process.env.TZ = fusoDiPrima; });

function vetrina(endsAt: string, fuso: string): string {
  process.env.TZ = fuso;
  const ctx = { promos: [{ id: 'p1', title: 'Oggi', discount_percent: 10, ends_at: endsAt }] } as unknown as SectionContext;
  return renderToStaticMarkup(createElement(PromotionsSection, { ctx }));
}

describe('R33-022 — «fino al» della vetrina è il giorno di Piacenza', () => {
  it('la promo «Oggi» del 6/11 (fine 22:59:59.999Z) si legge «fino al 06/11/2026» anche da Tokyo e da Auckland', () => {
    for (const fuso of ['Asia/Tokyo', 'Pacific/Auckland', 'America/New_York', 'Europe/Rome']) {
      const html = vetrina('2026-11-06T22:59:59.999Z', fuso);
      expect(html, fuso).toContain('fino al 06/11/2026');
      expect(html, fuso).not.toContain('fino al 07/11/2026');
    }
  });

  it("d'estate (fine 21:59:59.999Z del 15/7) e nelle domeniche del cambio d'ora resta il giorno di Piacenza", () => {
    const casi: Array<[string, string]> = [
      ['2026-07-15T21:59:59.999Z', 'fino al 15/07/2026'],
      ['2026-10-25T22:59:59.999Z', 'fino al 25/10/2026'],
      ['2027-03-28T21:59:59.999Z', 'fino al 28/03/2027'],
    ];
    for (const [fine, atteso] of casi) {
      expect(vetrina(fine, 'Asia/Tokyo'), fine).toContain(atteso);
    }
  });

  it("controprova: a New York la sera del 6/11 a Piacenza è già il 7 e la vetrina dice 7", () => {
    // 6/11 23:30Z = 7/11 00:30 a Piacenza, 6/11 18:30 a New York.
    expect(vetrina('2026-11-06T23:30:00.000Z', 'America/New_York')).toContain('fino al 07/11/2026');
  });
});

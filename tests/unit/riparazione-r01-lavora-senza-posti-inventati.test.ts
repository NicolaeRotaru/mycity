import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 27/11/2026 — «LAVORA CON NOI» PUBBLICAVA QUATTRO POSTI DI LAVORO CHE OGGI NON ESISTONO.
 *
 * Account negozi full-time, Coordinatore flotta rider full-time, Product Designer full-time,
 * Operatore supporto part-time, ognuno col suo «Candidati»: chi mandava il CV non riceveva
 * risposta, e arrivavano dati personali per posti che non ci sono. Oggi le posizioni aperte sono
 * zero: la pagina lo dice e offre la candidatura spontanea. La prova disegna la pagina vera.
 */

vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

import LavoraConNoiPage from '@/app/lavora-con-noi/page';

const testo = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

function sezionePosizioni(): { html: string; testo: string } {
  const pagina = renderToStaticMarkup(createElement(LavoraConNoiPage));
  const inizio = pagina.indexOf('id="posizioni"');
  expect(inizio, 'manca la sezione delle posizioni').toBeGreaterThan(-1);
  const fine = pagina.indexOf('</section>', inizio);
  const html = pagina.slice(inizio, fine);
  return { html, testo: testo(html) };
}

describe('«Lavora con noi» non pubblica posizioni inventate', () => {
  it('nessuna delle quattro posizioni scritte a mano compare, né un «Candidati»', () => {
    const pagina = testo(renderToStaticMarkup(createElement(LavoraConNoiPage)));
    for (const t of ['Account negozi', 'Coordinatore flotta', 'Product Designer', 'Operatore supporto clienti', 'Full-time', 'Part-time']) {
      expect(pagina, `«${t}» è un posto che oggi non esiste`).not.toContain(t);
    }
    expect(sezionePosizioni().html).not.toMatch(/>\s*Candidati\b/);
    expect(pagina).not.toMatch(/flotta/i);
  });

  it('con zero posizioni lo dice e offre la candidatura spontanea', () => {
    const { html, testo: t } = sezionePosizioni();
    expect(t).toMatch(/Oggi non abbiamo posizioni aperte/);
    expect(t).toMatch(/candidatura spontanea/);
    expect(html).toMatch(/href="mailto:[^"]+"/);
  });
});

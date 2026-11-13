/**
 * @vitest-environment jsdom
 */
/**
 * R06-011 (12/11/2026) — IL FUNNEL SENZA ISCRITTI SEMBRAVA UN ALLARME.
 *
 * Con zero iscritti le percentuali valevano 0: «0 / 0 (0.0%)» su quattro righe e
 * «Activation 7gg 0.0%» in rosso contro il bersaglio del 35-40%. Non c'era niente
 * da misurare, e la pagina diceva un disastro.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

const globale = globalThis as Record<string, unknown>;
afterEach(() => { delete globale.__DATI_QUERY__; });

const vuoto = {
  signups: 0, firstOrderWithin7d: 0, firstOrderEver: 0, multipleOrders: 0, aRischioChurn: 0,
  iscrittiLetti: 0, campione: false, cohortRetention: [],
};

function riquadro(radice: HTMLElement, etichetta: string) {
  const p = [...radice.querySelectorAll('p')].find((x) => x.textContent === etichetta);
  return p?.nextElementSibling as HTMLElement | null;
}

describe('R06-011 · il funnel senza iscritti', () => {
  it('dice «n.d.» in grigio, non 0.0% in rosso', async () => {
    globale.__DATI_QUERY__ = vuoto;
    const mod = await monta('app/admin/funnel/page.tsx');
    const s = accendi(mod.default as ComponentType);
    const testo = s.radice.textContent ?? '';
    expect(testo, 'Con zero iscritti la pagina scriveva «0.0%», come se l\'attivazione fosse crollata').not.toContain('0.0%');
    expect(testo).toContain('n.d.');
    const att = riquadro(s.radice, 'Activation 7gg');
    expect(att?.textContent).toBe('n.d.');
    expect(att?.className ?? '', 'Niente da misurare non e\' un allarme: niente rosso').not.toMatch(/secondary|olive|accent/);
    s.smonta();
  }, 60000);

  it('con iscritti veri le percentuali restano', async () => {
    globale.__DATI_QUERY__ = { ...vuoto, signups: 10, firstOrderWithin7d: 1, firstOrderEver: 4, multipleOrders: 2, iscrittiLetti: 10 };
    const mod = await monta('app/admin/funnel/page.tsx');
    const s = accendi(mod.default as ComponentType);
    expect(riquadro(s.radice, 'Activation 7gg')?.textContent).toBe('10.0%');
    expect(riquadro(s.radice, 'Activation 7gg')?.className).toContain('text-secondary-700');
    expect(riquadro(s.radice, '% buyer ricorrente')?.textContent).toBe('50.0%');
    s.smonta();
  }, 60000);
});

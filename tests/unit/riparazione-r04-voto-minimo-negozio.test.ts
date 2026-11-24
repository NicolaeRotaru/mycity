/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';
import { nomeAccessibile, controlli } from './aiuti/monta-componente';

/**
 * R04-008 — nella pagina del negozio il filtro diceva ancora «Rating minimo», mentre ricerca e
 * categoria dicono «Voto minimo». Prova leggera: la scritta del gruppo di pulsanti.
 */
describe('R04-008 — il filtro del negozio dice «Voto minimo»', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = (opzioni: { queryKey?: unknown[] }) =>
      opzioni?.queryKey?.[0] === 'store-categories' ? [{ id: 'c1', name: 'Pane' }] : undefined;
  });

  it('con i filtri aperti il gruppo del voto si chiama «Voto minimo» e non «Rating minimo»', async () => {
    const mod = await monta('components/StoreProductExplorer.tsx');
    const s = accendi(mod.default, { sellerId: 'n1' });
    const apri = controlli(s.radice).find((c) => nomeAccessibile(c).includes('Filtri'))!;
    s.agisci(() => clicca(apri));
    const gruppo = s.radice.querySelector('[role="group"][aria-labelledby]') as HTMLElement;
    const etichetta = s.radice.querySelector(`[id="${gruppo.getAttribute('aria-labelledby')}"]`) as HTMLElement;
    expect(etichetta.textContent?.trim()).toBe('Voto minimo');
    expect(s.radice.textContent).not.toMatch(/rating minimo/i);
    s.smonta();
  }, 60000);
});

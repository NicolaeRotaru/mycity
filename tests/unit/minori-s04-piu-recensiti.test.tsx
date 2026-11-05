/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * 5/11/2026 (S04, scheda 406) — «I più venduti · Quello che va forte questa settimana» apriva una
 * griglia ordinata per numero di recensioni, senza nessun dato di vendita. Il nome della pagina e
 * della voce nella barra delle categorie ora dicono quello che la griglia fa.
 */
afterEach(() => { document.body.innerHTML = ''; });

describe('la pagina /piu-venduti', () => {
  it('non promette vendite né «questa settimana», dice che sono i più recensiti', async () => {
    const mod = await monta('app/piu-venduti/page.tsx');
    const s = accendi(mod.default);
    await attendi();
    const testata = testoVisibile(s.radice.querySelector('h1')?.closest('header, section, div') ?? s.radice);
    expect(testata).not.toMatch(/vendut|best seller|questa settimana|va forte/i);
    expect(s.radice.querySelector('h1')?.textContent).toMatch(/recensit/i);
  });

  it('la voce della barra che porta lì non si chiama «Più venduti»', async () => {
    const mod = await monta('components/CategoryBar.tsx');
    const s = accendi(mod.default);
    await attendi();
    const voce = s.radice.querySelector('a[href="/piu-venduti"]');
    expect(voce).not.toBeNull();
    expect(testoVisibile(voce)).not.toMatch(/vendut/i);
    expect(testoVisibile(voce)).toMatch(/recensit/i);
  });
});

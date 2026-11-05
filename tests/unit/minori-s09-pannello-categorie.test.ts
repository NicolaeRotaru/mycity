/**
 * @vitest-environment jsdom
 */
/**
 * S09 — 1558: aprendo il pannello delle categorie il fuoco va sul primo elemento VISIBILE.
 * Qui la regola di Tailwind `sm:hidden` si simula con un foglio di stile vero: su schermo grande
 * la X (dentro un contenitore nascosto) non c'è, e il fuoco deve andare sul primo link.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

let schermo: { smonta: () => void } | null = null;
let foglio: HTMLStyleElement | null = null;

afterEach(() => {
  schermo?.smonta();
  schermo = null;
  foglio?.remove();
  foglio = null;
});

async function apri() {
  (globalThis as Record<string, unknown>).__DATI_QUERY__ = [
    { id: 'a', slug: 'gastronomia', name: 'Gastronomia', parent_id: null, icon: null },
  ];
  const mod = await monta('components/CategoryBar.tsx');
  const s = accendi(mod.default, {});
  schermo = s;
  const bottone = s.radice.querySelector('button') as HTMLButtonElement;
  s.agisci(() => { bottone.focus(); clicca(bottone); });
  return s.radice.querySelector('#mega-menu-categorie') as HTMLElement;
}

describe('1558 — il fuoco all\'apertura del pannello', () => {
  it('su schermo grande (X nascosta nel suo contenitore) va sul primo link, dentro il pannello', async () => {
    foglio = document.createElement('style');
    foglio.textContent = '.sm\\:hidden { display: none; }';
    document.head.appendChild(foglio);
    const pannello = await apri();
    await new Promise((r) => setTimeout(r, 30));
    expect(pannello.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(pannello.querySelector('a[href]'));
  }, 60000);

  it('sul telefono (X visibile) va sulla X, che sta prima dei link', async () => {
    const pannello = await apri();
    await new Promise((r) => setTimeout(r, 30));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Chiudi le categorie');
    expect(pannello.contains(document.activeElement)).toBe(true);
  }, 60000);
});

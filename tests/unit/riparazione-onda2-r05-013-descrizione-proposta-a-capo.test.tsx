// @vitest-environment jsdom
/**
 * R05-013 (onda 2) — LA DESCRIZIONE PROPOSTA NELLA CHAT ASSISTENZA ARRIVA INTERA MA SU UNA RIGA SOLA.
 *
 * Dal 27/11 la scheda della proposta porta il testo nuovo intero («Descrizione nuova, al posto di
 * quella attuale: «…»»), con i suoi a capo. Ma la riga della scheda non teneva gli a capo: tre
 * paragrafi diventavano un muro di testo su una riga, e il negoziante approvava una descrizione che
 * non si leggeva com'era. Qui il componente e' montato davvero: l'assistente propone una
 * descrizione di tre paragrafi.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { monta } from './aiuti/monta-componente';

const globali = globalThis as Record<string, unknown>;
globali.IS_REACT_ACT_ENVIRONMENT = true;

const DESCRIZIONE = 'Lievitazione di 36 ore.\n\nUvetta nel Marsala, senza canditi.\n\nSi conserva tre settimane.';
const PRODOTTO = {
  id: 'cccccccc-0000-0000-0000-0000000000a1', name: 'Panettone', description: 'Vecchia descrizione.', price: 28,
  compareAtPrice: null, unit: 'pezzo', condition: null, stock: 5, status: 'available', categorySlug: 'alimentari',
  subcategoryName: null, categoryName: 'Alimentari', tags: [], attributes: {}, image: null, hasVariants: false,
};

let radice: Root | null = null;
let div: HTMLDivElement | null = null;

beforeEach(async () => {
  Element.prototype.scrollTo = () => {};
  globali.__UTENTE__ = { id: 'forno' };
  globali.__GETTONE__ = 'gettone-finto';
  vi.stubGlobal('fetch', async () =>
    new Response(JSON.stringify({ reply: 'Ecco la proposta.', productId: PRODOTTO.id, patch: { description: DESCRIZIONE }, product: PRODOTTO }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  const Chat = (await monta('components/SupportProductAssistant.tsx')).default;
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
  await act(async () => { (radice as Root).render(createElement(Chat as never)); });
});
afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  vi.unstubAllGlobals();
});

async function scrivi(testo: string) {
  const area = div!.querySelector('textarea') as HTMLTextAreaElement;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    set.call(area, testo);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { (div!.querySelector('button[aria-label="Invia"]') as HTMLButtonElement).click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('R05-013 la descrizione proposta tiene i suoi a capo', () => {
  it('la riga della scheda con la descrizione nuova ha il testo intero e non appiattisce gli a capo', async () => {
    await scrivi('scrivi una descrizione nuova per il panettone');
    const riga = Array.from(div!.querySelectorAll('li')).find((li) => li.textContent?.includes('Descrizione nuova'));
    expect(riga, 'la scheda della proposta non mostra la descrizione nuova').toBeTruthy();
    const testo = Array.from(riga!.querySelectorAll('span')).find((s) => s.textContent?.includes('Descrizione nuova'))!;
    expect(testo.textContent).toContain(DESCRIZIONE);
    // Gli a capo ci sono nel testo: devono restare a capo anche a schermo.
    expect(testo.className, 'la descrizione di tre paragrafi si vede su una riga sola').toMatch(/whitespace-pre-(line|wrap)/);
    expect(testo.className).toMatch(/break-words/);
  });
});

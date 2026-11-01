/**
 * @vitest-environment jsdom
 */
// Collaudo S4 (lente B): dopo «Applica» con il prezzo fuori banda, la scheda
// della proposta nella chat Assistenza resta «Prezzo: 20 → 30» con la spunta
// «Modifiche salvate», mentre il server il prezzo NON l'ha scritto.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';
import { resolveAiPatch } from '@/lib/products/aiPatch';

const PRODOTTO = {
  id: 'p1', name: 'Cesto di pane', description: 'Pane misto del giorno', price: 20, compareAtPrice: null,
  unit: 'pezzo', condition: null, stock: 5, status: 'available', categorySlug: null, subcategoryName: null,
  categoryName: null, tags: [], attributes: {}, image: null, hasVariants: false,
};
const PATCH = { price: 30, name: 'Cesto di pane misto' };

describe('la scheda della chat dopo Applica, col prezzo rifiutato', () => {
  let Chat: ComponentType<Record<string, unknown>>;
  let fetchOriginale: typeof fetch;
  const g = globalThis as Record<string, unknown>;
  beforeAll(async () => {
    fetchOriginale = globalThis.fetch;
    if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
    Chat = (await monta('components/SupportProductAssistant.tsx')).default as ComponentType<Record<string, unknown>>;
  }, 60000);
  afterEach(() => {
    globalThis.fetch = fetchOriginale;
    delete g.__UTENTE__;
    delete g.__GETTONE__;
    document.body.innerHTML = '';
  });

  it('non mostra «Modifiche salvate» accanto a un prezzo che non e entrato', async () => {
    g.__UTENTE__ = { id: 'forno-1' };
    g.__GETTONE__ = 'gettone-di-prova';
    // La risposta di catalog-apply com'e' oggi: calcolata dalla funzione vera.
    const { changed, rifiutati } = resolveAiPatch({
      patch: PATCH,
      current: { attributes: {}, category_id: null, has_variants: false, price: 20 },
      categories: [],
    });
    expect(rifiutati.map((r) => r.campo)).toEqual(['price']);
    globalThis.fetch = (async (input: unknown) => {
      const u = String(input);
      if (u.includes('/api/ai/catalog-chat')) {
        return { ok: true, status: 200, json: async () => ({ reply: 'Ecco la proposta', product: PRODOTTO, patch: PATCH }) } as unknown as Response;
      }
      if (u.includes('/api/ai/catalog-apply')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, changed, rifiutati, product: { ...PRODOTTO, name: PATCH.name } }) } as unknown as Response;
      }
      throw new Error(`rotta non prevista: ${u}`);
    }) as typeof fetch;

    const s = accendi(Chat);
    const casella = s.radice.querySelector('textarea') as HTMLTextAreaElement;
    s.agisci(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(casella, 'metti il cesto a 30 euro e chiamalo cesto di pane misto');
      casella.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    s.agisci(() => clicca(s.radice.querySelector('button[aria-label="Invia"]')!));
    for (let i = 0; i < 40 && !testoVisibile(s.radice).includes('Ecco la proposta'); i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    const applica = [...s.radice.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Applica');
    expect(applica, 'pulsante Applica non trovato').toBeTruthy();
    s.agisci(() => clicca(applica!));
    for (let i = 0; i < 40 && !testoVisibile(s.radice).includes('Modifiche salvate'); i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    const schermo = testoVisibile(s.radice);
    console.log('SCHERMO DOPO APPLICA:', schermo.slice(schermo.indexOf('Cesto')));
    const promettePrezzo = /Prezzo: .*20.* → .*30/.test(schermo);
    const diceSalvate = schermo.includes('Modifiche salvate');
    const diceNonEntrato = /NON applicat|non .*entrat|solo in parte/i.test(schermo);
    expect(promettePrezzo && diceSalvate && !diceNonEntrato,
      'la scheda dice «Prezzo 20 → 30» e «Modifiche salvate», ma il prezzo e rimasto 20').toBe(false);
    s.smonta();
  }, 30000);
});

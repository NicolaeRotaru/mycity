import { describe, it, expect } from 'vitest';
import { pianoPatchPerIlModulo, resolveAiPatch } from '@/lib/products/aiPatch';

/**
 * R04-020 — Il modulo del prodotto applicava le proposte dell'assistente con
 * una seconda copia delle regole del server, e le due copie erano diverse:
 * disponibilita' sui prodotti con varianti e rimozione di un attributo che
 * non c'era. Adesso usano le stesse funzioni e dicono la stessa cosa.
 */

const CATEGORIE = [{ id: 'casa', name: 'Casa', slug: 'casa', parent_id: null }];

function modulo(patch: object, ctx: { haVarianti?: boolean; attributiAttuali?: Record<string, unknown> }) {
  return pianoPatchPerIlModulo(patch as never, { categorie: CATEGORIE, categoriaAttuale: 'casa', modo: 'edit', ...ctx });
}
function server(patch: object, current: { has_variants?: boolean; attributes?: Record<string, unknown> }) {
  return resolveAiPatch({ patch: patch as never, current: { category_id: 'casa', price: 10, tags: [], ...current } as never, categories: CATEGORIE });
}

describe('modulo e server, stesse regole', () => {
  it('prodotto con varianti: la disponibilita\' non si scrive da nessuna delle due parti', () => {
    const piano = modulo({ stock: 7 }, { haVarianti: true });
    expect(piano.cambiati).not.toContain('disponibilità');
    expect(server({ stock: 7 }, { has_variants: true }).changed).not.toContain('disponibilità');
  });

  it('prodotto senza varianti: la disponibilita\' si scrive da tutte e due', () => {
    expect(modulo({ stock: 7 }, { haVarianti: false }).cambiati).toContain('disponibilità');
    expect(server({ stock: 7 }, { has_variants: false }).changed).toContain('disponibilità');
  });

  it('togliere un attributo che non c\'e\': nessuno dice «rimosso»', () => {
    const piano = modulo({ attributes_remove: ['colore'] }, { attributiAttuali: {} });
    expect(piano.cambiati).toEqual([]);
    expect(server({ attributes_remove: ['colore'] }, { attributes: {} }).changed).toEqual([]);
  });

  it('togliere un attributo che c\'e\': tutti e due lo tolgono', () => {
    const piano = modulo({ attributes_remove: ['colore'] }, { attributiAttuali: { colore: 'rosso' } });
    expect(piano.cambiati).toEqual(['rimosso colore']);
    expect(server({ attributes_remove: ['colore'] }, { attributes: { colore: 'rosso' } }).changed).toEqual(['rimosso colore']);
  });

  it('il server toglie anche una chiave rimasta vuota nel JSON, come prima', () => {
    expect(server({ attributes_remove: ['colore'] }, { attributes: { colore: '' } }).changed).toEqual(['rimosso colore']);
  });
});

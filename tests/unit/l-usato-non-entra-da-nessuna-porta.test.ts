import { describe, it, expect } from 'vitest';

/**
 * 30/10/2026 — «USATO» E «RICONDIZIONATO» NON ENTRANO DA NESSUNA PORTA.
 *
 * MyCity non vende l'usato (CONTESTO_BUSINESS.md, fra le cose da non costruire mai). Il menu della
 * condizione nel modulo prodotto già non le offriva più (`condizioneDaScegliere`), ma le altre porte
 * le scrivevano ancora:
 *   · la lettura della foto (`buildDraftProductInsert`, attributo «condizione»);
 *   · il suggerimento dell'assistente nel modulo (`pianoPatchPerIlModulo`);
 *   · le rotte dell'assistente che scrivono sul prodotto (`resolveAiPatch`);
 *   · lo schema dello strumento dato al modello (`PRODUCT_PATCH_PROPERTIES.condition.enum`).
 * Adesso si scartano tutte come nel menu. Un prodotto vecchio salvato con «usato» non perde il
 * valore: il suggerimento scartato non scrive niente, non lo cancella.
 */

const MODULO = { categorie: [], categoriaAttuale: null, modo: 'create' as const };
const DA_SCARTARE = ['usato', 'Usato, come nuovo', 'ricondizionato', 'Ricondizionato garantito'];

describe('«usato» e «ricondizionato» non entrano da nessuna porta', () => {
  it('la regola sola: dal suggerimento passa solo una condizione che il menu offre', async () => {
    const { condizioneDalSuggerimento } = await import('@/lib/products/schema');
    for (const c of DA_SCARTARE) expect(condizioneDalSuggerimento(c), c).toBeNull();
    expect(condizioneDalSuggerimento('Nuovo')).toBe('nuovo');
    expect(condizioneDalSuggerimento('boh')).toBe('');
  });

  it('il suggerimento dell’assistente nel modulo non scrive «usato» nella condizione', async () => {
    const { pianoPatchPerIlModulo } = await import('@/lib/products/aiPatch');
    for (const c of DA_SCARTARE) {
      const piano = pianoPatchPerIlModulo({ condition: c }, MODULO);
      expect(piano.scritture.filter((s) => s.campo === 'condition'), c).toEqual([]);
    }
    const nuovo = pianoPatchPerIlModulo({ condition: 'nuovo' }, MODULO);
    expect(nuovo.scritture.find((s) => s.campo === 'condition')?.valore).toBe('nuovo');
    // Togliere la condizione resta possibile.
    const via = pianoPatchPerIlModulo({ condition: null }, MODULO);
    expect(via.scritture.find((s) => s.campo === 'condition')?.valore).toBe('');
  });

  it('le rotte dell’assistente non scrivono «usato», e un prodotto vecchio non perde il suo valore', async () => {
    const { resolveAiPatch } = await import('@/lib/products/aiPatch');
    const current = { attributes: {}, category_id: null };
    for (const c of DA_SCARTARE) {
      const r = resolveAiPatch({ patch: { condition: c }, current, categories: [] });
      expect('condition' in r.update, c).toBe(false);
    }
    expect(resolveAiPatch({ patch: { condition: 'nuovo' }, current, categories: [] }).update.condition).toBe('nuovo');
    expect(resolveAiPatch({ patch: { condition: null }, current, categories: [] }).update.condition).toBeNull();
  });

  it('la lettura della foto non mette «usato» nella bozza', async () => {
    const { buildDraftProductInsert } = await import('@/lib/products/draftFromVision');
    for (const c of DA_SCARTARE) {
      const bozza = buildDraftProductInsert({
        draft: { name: 'Bicicletta', attributes: { condizione: c } },
        imageUrls: [],
        categories: [],
        sellerId: 'venditore-1',
      });
      expect(bozza.condition, c).toBeNull();
    }
    const nuovo = buildDraftProductInsert({
      draft: { name: 'Bicicletta', attributes: { condizione: 'nuovo' } },
      imageUrls: [],
      categories: [],
      sellerId: 'venditore-1',
    });
    expect(nuovo.condition).toBe('nuovo');
  });

  it('lo strumento dato al modello offre solo «nuovo» (o nessuna)', async () => {
    const { PRODUCT_PATCH_PROPERTIES } = await import('@/lib/ai/patchSchema');
    const condizione = PRODUCT_PATCH_PROPERTIES.condition as { enum: unknown[] };
    expect(condizione.enum).toEqual(['nuovo', null]);
  });
});

import { describe, it, expect } from 'vitest';
import { resolveAiPatch, pianoPatchPerIlModulo, type AiProductPatch } from '@/lib/products/aiPatch';
import { PRODUCT_PATCH_PROPERTIES, PROPRIETA_EDITORIALI } from '@/lib/ai/patchSchema';

/**
 * 1/11/2026 — L'AI METTEVA UN «PREZZO PIENO» PRESO DAL MERCATO.
 *
 * «Migliora tutto» cerca sul web un prezzo di mercato. Il prezzo proposto passa
 * dalla banda del 30%; il prezzo pieno barrato no: qualunque numero positivo
 * entrava nel modulo o nel database, e la pagina del prodotto mostrava uno
 * sconto che il negozio non ha mai fatto. Lo sconto barrato resta manuale.
 */

const PROPOSTA = { compare_at_price: 99 } as AiProductPatch;

describe('il prezzo pieno barrato non lo propone l\'AI', () => {
  it('server: una proposta con compare_at_price 99 non scrive il prezzo pieno', () => {
    const { update } = resolveAiPatch({
      patch: PROPOSTA,
      current: { attributes: {}, category_id: null, has_variants: false, price: 20 },
      categories: [],
    });
    expect(update).not.toHaveProperty('compare_at_price');
  });

  it('modulo: la stessa proposta non tocca il campo «prezzo pieno»', () => {
    const piano = pianoPatchPerIlModulo(PROPOSTA, {
      prezzoAttuale: 20,
      categorie: [],
      categoriaAttuale: null,
      modo: 'edit',
    });
    expect(piano.scritture.map((s) => s.campo)).not.toContain('compareAtPrice');
  });

  it('gli schemi dati al modello non offrono il campo', () => {
    expect(PRODUCT_PATCH_PROPERTIES).not.toHaveProperty('compare_at_price');
    expect(PROPRIETA_EDITORIALI).not.toHaveProperty('compare_at_price');
  });
});

import { describe, it, expect } from 'vitest';
import {
  MOTIVO_PREZZO_PIENO_RIFIUTATO,
  pianoPatchPerIlModulo,
  resolveAiPatch,
  type AiProductPatch,
  type CategoryRow,
} from '@/lib/products/aiPatch';

/**
 * R03-018 — Il modulo del prodotto applicava le proposte dell'assistente con
 * una seconda copia delle regole del server, e le due copie erano gia'
 * diverse. Dopo R04-020 ne restavano due: il prezzo pieno barrato proposto
 * (il server diceva «NON applicato», il modulo niente) e una caratteristica
 * scritta e tolta nella stessa proposta (il server la toglieva, il modulo la
 * lasciava). Qui le due strade passano sugli stessi casi e devono scrivere e
 * dire la stessa cosa.
 */

const CATEGORIE: CategoryRow[] = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'pane', name: 'Pane e forno', slug: 'pane-e-forno', parent_id: 'alim' },
  { id: 'casa', name: 'Casa', slug: 'casa', parent_id: null },
];

type Prodotto = {
  category_id: string;
  price: number;
  attributes: Record<string, unknown> | null;
  has_variants: boolean;
};

/** Cosa scrive il modulo, rimesso nella forma dell'`update` del server. */
function scrittoDalModulo(patch: AiProductPatch, p: Prodotto) {
  const piano = pianoPatchPerIlModulo(patch, {
    prezzoAttuale: p.price,
    categorie: CATEGORIE,
    categoriaAttuale: p.category_id,
    modo: 'edit',
    haVarianti: p.has_variants,
    attributiAttuali: p.attributes,
  });
  const update: Record<string, unknown> = {};
  const attributi: Record<string, unknown> = { ...(p.attributes ?? {}) };
  let toccaAttributi = false;
  for (const s of piano.scritture) {
    if (s.campo === 'attributo') {
      toccaAttributi = true;
      if (s.valore === '') delete attributi[s.chiave];
      else attributi[s.chiave] = s.valore;
    } else if (s.campo === 'compareAtPrice') update.compare_at_price = s.valore;
    else if (s.campo === 'condition') update.condition = s.valore === '' ? null : s.valore;
    else update[s.campo] = s.valore;
  }
  if (toccaAttributi) update.attributes = attributi;
  const motivi = piano.daControllare.map((v) => v.motivo).sort();
  return { update, cambiati: [...piano.cambiati].sort(), motivi };
}

function scrittoDalServer(patch: AiProductPatch, p: Prodotto) {
  const r = resolveAiPatch({ patch, current: p, categories: CATEGORIE });
  const motivi = [...new Set([...r.rifiutati.map((x) => x.motivo), ...r.changed.filter((c) => / NON /.test(c))])].sort();
  return { update: r.update, cambiati: r.changed.filter((c) => !/ NON /.test(c)).sort(), motivi };
}

const FOCACCIA: Prodotto = { category_id: 'alim', price: 10, attributes: { allergeni: 'glutine', marca: 'Forno Rossi' }, has_variants: false };
const VASO: Prodotto = { category_id: 'casa', price: 20, attributes: null, has_variants: true };

const CASI: AiProductPatch[] = [
  { name: 'Focaccia ligure' },
  { description: 'x'.repeat(5000) },
  { price: 11 },
  { price: 40 },
  { compare_at_price: null },
  { compare_at_price: 25 },
  { unit: 'kg' },
  { condition: null },
  { condition: 'usato' },
  { stock: 3 },
  { unlimited_stock: true },
  { category_slug: 'casa' },
  { category_slug: 'alimentari', subcategory_name: 'Pane e forno' },
  { tags: ['Forno', 'forno', ' pane,'] },
  { attributes: { Marca: 'Mulino' } },
  { attributes: { colore: 'rosso' } },
  { attributes: { allergeni: 'latte' } },
  { attributes_remove: ['marca'] },
  { attributes_remove: ['assente'] },
  { attributes_remove: ['allergeni'] },
  { attributes: { marca: 'Mulino' }, attributes_remove: ['marca'] },
  { attributes: { confezione: 'Busta' }, attributes_remove: ['confezione'] },
  { status: 'draft' },
  { category_slug: 'casa', attributes: { marca: 'IKEA', origine: 'Italia' } },
  { price: 40, compare_at_price: 50, tags: ['a'] },
];

describe('modulo e server: una copia delle regole, lo stesso risultato', () => {
  for (const prodotto of [FOCACCIA, VASO]) {
    for (const patch of CASI) {
      it(`${prodotto.category_id} · ${JSON.stringify(patch).slice(0, 80)}`, () => {
        const m = scrittoDalModulo(patch, prodotto);
        const s = scrittoDalServer(patch, prodotto);
        expect(m.update).toEqual(s.update);
        expect(m.cambiati).toEqual(s.cambiati);
        expect(m.motivi).toEqual(s.motivi);
      });
    }
  }

  it('il prezzo pieno barrato proposto: anche il modulo dice che non e\' entrato', () => {
    const m = scrittoDalModulo({ compare_at_price: 25 }, FOCACCIA);
    expect(m.update).not.toHaveProperty('compare_at_price');
    expect(m.motivi).toEqual([MOTIVO_PREZZO_PIENO_RIFIUTATO]);
  });

  it('scritta e tolta nella stessa proposta: tutti e due la tolgono', () => {
    const m = scrittoDalModulo({ attributes: { confezione: 'Busta' }, attributes_remove: ['confezione'] }, FOCACCIA);
    expect(m.update.attributes).toEqual(FOCACCIA.attributes);
    expect(m.cambiati).toContain('rimosso confezione');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeCondition, condizioneDalSuggerimento } from '@/lib/products/schema';
import { pianoPatchPerIlModulo, resolveAiPatch } from '@/lib/products/aiPatch';

/**
 * S06 — La condizione proposta dall'assistente o letta dalla foto.
 * 2261: «seminuovo», «come nuovo», «non nuovo» non entrano come «nuovo».
 * 2289: «Nuovo, mai usato» è nuovo.
 * 2268: «Used», «second hand» non cancellano la condizione già scritta.
 * 2266: la condizione scartata si dice al negoziante.
 * 2284: «togli la condizione» la toglie anche nel modulo.
 */
const CATEGORIE = [{ id: 'c1', name: 'Casa', slug: 'casa', parent_id: null }];
const ctx = { prezzoAttuale: 10, categorie: CATEGORIE, categoriaAttuale: 'c1', modo: 'edit' as const };
const current = { attributes: {}, category_id: 'c1', has_variants: false, price: 10 };

describe('2261 · 2289 — la lettura del testo', () => {
  it.each([
    ['Seminuovo', 'usato'], ['come nuovo', 'usato'], ['quasi nuovo', 'usato'], ['non nuovo', 'usato'],
    ['Nuovo, mai usato', 'nuovo'], ['nuovo', 'nuovo'], ['Used', 'usato'], ['second hand', 'usato'],
    ['Ricondizionato', 'ricondizionato'], ['ottimo', ''],
  ])('«%s» → %s', (testo, atteso) => { expect(normalizeCondition(testo)).toBe(atteso); });
  it('dal suggerimento: «come nuovo» si scarta, «mai usato» entra', () => {
    expect(condizioneDalSuggerimento('come nuovo')).toBeNull();
    expect(condizioneDalSuggerimento('Nuovo, mai usato')).toBe('nuovo');
  });
});

describe('2268 — testo non riconosciuto', () => {
  it('il modulo non scrive niente', () => {
    const p = pianoPatchPerIlModulo({ condition: 'ottimo stato' } as never, ctx);
    expect(p.scritture.find((s) => s.campo === 'condition')).toBeUndefined();
  });
  it('il server non svuota la condizione', () => {
    const r = resolveAiPatch({ patch: { condition: 'ottimo stato' } as never, current: current as never, categories: CATEGORIE as never });
    expect('condition' in r.update).toBe(false);
  });
});

describe('2266 — l\'usato scartato si dice', () => {
  it('nel modulo è un avviso', () => {
    const p = pianoPatchPerIlModulo({ condition: 'usato' } as never, ctx);
    expect(p.avvisi.join(' ')).toContain('solo prodotti nuovi');
  });
  it('sul server è fra i rifiutati', () => {
    const r = resolveAiPatch({ patch: { condition: 'usato' } as never, current: current as never, categories: CATEGORIE as never });
    expect(r.rifiutati.map((x) => x.motivo).join(' ')).toContain('solo prodotti nuovi');
  });
});

describe('2284 — togliere la condizione', () => {
  it('il piano la svuota e il modulo esegue lo svuotamento', () => {
    const p = pianoPatchPerIlModulo({ condition: null } as never, ctx);
    expect(p.scritture.find((s) => s.campo === 'condition')?.valore).toBe('');
    expect(readFileSync('components/seller/ProductForm.tsx', 'utf8')).toContain("if (s.valore === '') setCondition('');");
  });
});

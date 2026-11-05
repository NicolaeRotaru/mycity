import { describe, it, expect } from 'vitest';
import { pianoPatchPerIlModulo, resolveAiPatch, MAX_NOME_PRODOTTO } from '@/lib/products/aiPatch';

/**
 * S06 — Le proposte dell'assistente sul prodotto (modulo e server leggono uguale).
 * 1673: il nome troppo lungo si taglia anche nel modulo.
 * 2165: un sì/no mandato come booleano entra nella casella.
 * 1687: «Colore», «tipo prodotto» si leggono come chiavi della scheda; senza niente di
 *       entrato, attributes non va in update.
 */
const CATEGORIE = [{ id: 'casa', name: 'Casa', slug: 'casa', parent_id: null }];
const ctx = { prezzoAttuale: 40, categorie: CATEGORIE, categoriaAttuale: 'casa', modo: 'edit' as const };
const current = { attributes: { colore: 'Blu' }, category_id: 'casa', has_variants: false, price: 40 };
const server = (patch: Record<string, unknown>) =>
  resolveAiPatch({ patch: patch as never, current: current as never, categories: CATEGORIE as never });

describe('1673 — nome lungo', () => {
  it('il modulo lo taglia come il server', () => {
    const lungo = 'Sedia '.repeat(40);
    const p = pianoPatchPerIlModulo({ name: lungo } as never, ctx);
    const nome = p.scritture.find((s) => s.campo === 'name')?.valore as string;
    expect(nome.length).toBeLessThanOrEqual(MAX_NOME_PRODOTTO);
    expect(nome).toBe(server({ name: lungo }).update.name);
  });
});

describe('2165 — casella mandata come booleano', () => {
  it('true e false entrano, nel modulo e sul server', () => {
    const p = pianoPatchPerIlModulo({ attributes: { montaggio: true } } as never, ctx);
    expect(p.scritture.find((s) => (s as { chiave?: string }).chiave === 'montaggio')?.valore).toBe(true);
    expect(server({ attributes: { montaggio: false } }).update.attributes).toMatchObject({ montaggio: false });
  });
});

describe('1687 — chiavi scritte con la maiuscola o lo spazio', () => {
  it('«Colore» e «tipo prodotto» entrano', () => {
    const r = server({ attributes: { Colore: 'Rosso', 'tipo prodotto': 'Sedia' } });
    expect(r.update.attributes).toMatchObject({ colore: 'Rosso', tipo_prodotto: 'Sedia' });
    const p = pianoPatchPerIlModulo({ attributes: { Colore: 'Rosso' } } as never, ctx);
    expect(p.scritture.find((s) => (s as { chiave?: string }).chiave === 'colore')?.valore).toBe('Rosso');
  });
  it('se non entra niente, attributes non va in update', () => {
    const r = server({ attributes: { stile: 'Astronave' } });
    expect('attributes' in r.update).toBe(false);
    expect(r.changed).toHaveLength(0);
  });
});

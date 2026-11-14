import { describe, it, expect } from 'vitest';
import { getAttributesForCategory } from '@/lib/category-attributes';

/** R18-014 — Un cerchio nei genitori delle categorie (A→B→A) non blocca la risalita. */
describe('R18-014 risalita dei genitori con un cerchio', () => {
  it('A→B→A termina e dà una risposta', { timeout: 3000 }, () => {
    const cat = [
      { id: 'a', slug: 'a', parent_id: 'b' },
      { id: 'b', slug: 'b', parent_id: 'a' },
    ];
    // Senza la correzione la risalita non finisce mai: un contatore la ferma con un errore
    // (un ciclo sincrono non lo interrompe nessun timeout).
    let giri = 0;
    const find = cat.find.bind(cat);
    (cat as unknown as { find: unknown }).find = (...a: Parameters<typeof find>) => {
      if (++giri > 1000) throw new Error('la risalita non finisce');
      return find(...a);
    };
    let r: ReturnType<typeof getAttributesForCategory> | null = null;
    try { r = getAttributesForCategory(cat, 'a'); } catch { r = null; }
    expect(giri).toBeLessThan(100);
    expect(r).not.toBeNull();
    expect(r!.fields).toEqual([]);
    expect(typeof r!.topSlug).toBe('string');
  });
  it("giro di correzione: l'obbligo alimentare della radice arriva in fondo a una catena di 30 livelli", () => {
    const cat: Array<{ id: string; slug: string; parent_id: string | null; richiede_dichiarazioni_alimentari?: boolean }> = [
      { id: 'l1', slug: 'gastronomia', parent_id: null, richiede_dichiarazioni_alimentari: true },
    ];
    for (let n = 2; n <= 30; n++) cat.push({ id: `l${n}`, slug: `livello-${n}`, parent_id: `l${n - 1}` });
    const r = getAttributesForCategory(cat, 'l30');
    expect(r.topSlug).toBe('gastronomia');
    expect(r.fields.map((f) => f.key)).toContain('allergeni');
  });
  it('una catena normale arriva ancora alla radice', () => {
    const cat = [
      { id: 'r', slug: 'alimentari', parent_id: null },
      { id: 'f', slug: 'figlia', parent_id: 'r' },
    ];
    expect(getAttributesForCategory(cat, 'f').topSlug).toBe('alimentari');
  });
});

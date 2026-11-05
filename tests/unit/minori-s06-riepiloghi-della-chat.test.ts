import { describe, it, expect } from 'vitest';
import { dichiarazioniDellaBozza, righeDellaProposta } from '@/lib/products/prontoPerLaVendita';

/**
 * S06 — I riepiloghi della chat e della bozza da foto.
 * 2163: «no», «0», «falso» non contano come dichiarazione letta.
 * 2646: la scheda della proposta non promette «Prezzo pieno → 99 €».
 */
describe('2163 — il no del riepilogo', () => {
  it('«Senza glutine: no» non è una dichiarazione da confermare, «sì» sì', () => {
    const lette = (v: string) =>
      dichiarazioniDellaBozza({ category_slug: 'alimentari', attributes: { senza_glutine: v } } as never).lette.map((d) => d.chiave);
    for (const no of ['no', 'NO', '0', 'falso', 'false']) expect(lette(no), no).toEqual([]);
    expect(lette('sì')).toEqual(['senza_glutine']);
  });
});

describe('2646 — prezzo pieno nella proposta', () => {
  it('si dice che non si applica', () => {
    const righe = righeDellaProposta({ compare_at_price: 99 } as never, { price: 50 } as never).join(' | ');
    expect(righe).not.toMatch(/Prezzo pieno → /);
    expect(righe).toContain('NON si applica');
  });
});

describe('1698 — la scheda della proposta non promette caratteristiche che il server butta', () => {
  it('campo che la scheda non ha e scelta fuori elenco: «NON si applica»', () => {
    const righe = righeDellaProposta(
      { attributes: { gusto: 'Fragola', stile: 'Astronave', colore: 'Rosso' }, attributes_remove: ['gusto'] } as never,
      { price: 40, categorySlug: 'casa' },
    );
    expect(righe).toContain('gusto → Fragola: NON si applica, la scheda di questo prodotto non ha questo campo');
    expect(righe).toContain('Stile → Astronave: NON si applica, non è fra i valori possibili');
    expect(righe).toContain('Colore → Rosso');
    expect(righe.join(' ')).not.toContain('Rimuovi gusto');
  });
  it('e dopo «Applica» il server non dice «salvato» per niente (attributes fuori da update)', async () => {
    const { resolveAiPatch } = await import('@/lib/products/aiPatch');
    const r = resolveAiPatch({
      patch: { attributes: { gusto: 'Fragola' } } as never,
      current: { attributes: {}, category_id: 'casa', has_variants: false, price: 40 } as never,
      categories: [{ id: 'casa', name: 'Casa', slug: 'casa', parent_id: null }] as never,
    });
    expect(Object.keys(r.update)).toHaveLength(0);
  });
});

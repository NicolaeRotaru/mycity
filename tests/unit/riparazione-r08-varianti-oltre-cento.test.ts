import { describe, expect, it } from 'vitest';
import { buildCombinations, reconcileVariants } from '@/lib/products/variants';

/**
 * R08-011 — Un capo con troppe combinazioni di taglia e colore. Il taglio a 100 resta (PostgREST
 * espone al massimo 1000 righe e chi legge le varianti non pagina: sopra quel numero il taglio
 * tornerebbe silenzioso e il salvataggio farebbe duplicati). Qui il comportamento: il tetto sul totale.
 * Il conto e le scelte della scheda: riparazione-r08-varianti-funzioni-pure; la pagina vera:
 * riparazione-r08-varianti-scheda.
 */
const taglie = ['34', '36', '38', '40', '42', '44', '46', '48', '50', '52', '54'];
const colori = ['Bianco', 'Nero', 'Blu', 'Rosso', 'Verde', 'Giallo', 'Grigio', 'Rosa', 'Viola', 'Beige'];
const tipi = [
  { name: 'Taglia', values: taglie },
  { name: 'Colore', values: colori },
];
const valoriN = (n: number) => Array.from({ length: n }, (_, i) => `v${i + 1}`);

describe('R08-011 il tetto sul totale', () => {
  it('con 110 combinazioni ne restano le prime 100, nell\'ordine, senza duplicati', () => {
    const combos = buildCombinations(tipi);
    expect(combos).toHaveLength(100);
    expect(combos[0]).toEqual({ Taglia: '34', Colore: 'Bianco' });
    expect(new Set(combos.map((c) => `${c.Taglia}|${c.Colore}`)).size).toBe(100);
  });
  it('con 27000 possibili non se ne creano più di 100 (PostgREST ne darebbe 1000 al massimo)', () => {
    const molte = [0, 1, 2].map((i) => ({ name: `Asse${i}`, values: valoriN(30) }));
    expect(buildCombinations(molte)).toHaveLength(100);
  });
  it('fino a 100 non si taglia niente', () => {
    expect(buildCombinations([{ name: 'Taglia', values: valoriN(10) }, { name: 'Colore', values: valoriN(10) }])).toHaveLength(100);
  });
  it('anche l\'editor tiene al massimo 100 varianti, conservando lo stock di quelle che restano', () => {
    const next = reconcileVariants(tipi, [{ options: { Taglia: '34', Colore: 'Nero' }, label: '34 · Nero', stock: 7 }]);
    expect(next).toHaveLength(100);
    expect(next[1].stock).toBe(7);
  });
});


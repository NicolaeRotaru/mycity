import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { prezzoAiFuoriBanda } from '@/lib/products/aiPatch';
import { leggiPrezzo } from '@/app/seller/products/import/csv';

/**
 * R03-022 (collaudo K04) — Il freno del 30% sui prezzi proposti dall'assistente legge il prezzo
 * all'italiana.
 *
 * Da quando il campo «Prezzo (€)» è di testo (R03-022), getValues('price') dà «12,50». Il modulo
 * lo passava grezzo a prezzoAiFuoriBanda come prezzo attuale: Number('12,50') è NaN, il freno
 * crede che il prodotto sia nuovo e lascia passare qualunque prezzo (9 € al posto di 12,50).
 * Ora il modulo passa prezzoDelCampo(...), cioè lo stesso numero di anteprima e salvataggio.
 */
describe('R03-022 — il freno del 30% con il prezzo scritto a mano', () => {
  it('«12,50» letto all italiana: una proposta a 5 € è fuori banda (col testo grezzo il freno si spegneva)', () => {
    expect(prezzoAiFuoriBanda(5, '12,50'), 'controprova: il testo grezzo spegne il freno').toBe(false);
    expect(prezzoAiFuoriBanda(5, leggiPrezzo('12,50'))).toBe(true);
    expect(prezzoAiFuoriBanda(12, leggiPrezzo('12,50'))).toBe(false);
  });

  it('il modulo passa al freno il prezzo letto, non il testo del campo (le due porte: foto e assistente)', () => {
    const src = readFileSync('components/seller/ProductForm.tsx', 'utf8');
    const passaggi = src.match(/prezzoAttuale:\s*[^,}\n]+/g) ?? [];
    expect(passaggi.length).toBe(2);
    for (const p of passaggi) expect(p, 'il testo «12,50» arriva al freno come NaN').toContain('prezzoDelCampo(');
  });
});

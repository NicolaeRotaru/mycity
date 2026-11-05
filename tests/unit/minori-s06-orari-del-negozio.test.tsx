import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import StoreHoursEditor, { erroreDegliOrari, erroreDelleFasce, prossimaFascia } from '@/components/seller/StoreHoursEditor';

/**
 * S06 — Gli orari del negozio.
 * 175:  orario vuoto, chiusura prima dell'apertura e fasce sovrapposte si dicono e non si salvano;
 *       la seconda fascia parte dopo la prima.
 * 2459: orari mai impostati non si disegnano come «Chiuso».
 */
describe('175 — fasce sbagliate', () => {
  it('le riconosce', () => {
    expect(erroreDelleFasce([['16:30', '07:30']])).toMatch(/dopo quello di apertura/);
    expect(erroreDelleFasce([['09:00', '']])).toMatch(/tutti e due/);
    expect(erroreDelleFasce([['09:00', '13:00'], ['12:00', '15:00']])).toMatch(/sovrappongono/);
    expect(erroreDelleFasce([['07:30', '13:00'], ['16:00', '19:30']])).toBeNull();
    expect(erroreDegliOrari({ mon: [['09:00', '13:00']], sat: [['16:30', '07:30']] })).toMatch(/^Sabato:/);
  });
  it('la seconda fascia parte dopo la prima', () => {
    expect(prossimaFascia([['09:00', '13:00']])).toEqual(['16:00', '19:00']);
    expect(prossimaFascia([])).toEqual(['09:00', '13:00']);
  });
  it('il profilo non salva con un errore e la riga lo mostra', () => {
    expect(readFileSync('components/VendorForm.tsx', 'utf8')).toContain('const erroreOrari = erroreDegliOrari(hours);');
    const html = renderToStaticMarkup(<StoreHoursEditor value={{ mon: [['16:30', '07:30']] }} onChange={() => {}} />);
    expect(html).toContain('role="alert"');
  });
});

describe('2459 — orari mai impostati', () => {
  it('non dice «Chiuso» e avvisa che oggi si ricevono ordini a ogni ora', () => {
    const html = renderToStaticMarkup(<StoreHoursEditor value={{}} onChange={() => {}} />);
    expect(html).not.toContain('>Chiuso<');
    expect(html).toContain('Orari non ancora impostati');
  });
  it('con la settimana scritta, il giorno vuoto è «Chiuso»', () => {
    const settimana = { mon: [['09:00', '13:00']], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } as never;
    expect(renderToStaticMarkup(<StoreHoursEditor value={settimana} onChange={() => {}} />)).toContain('>Chiuso<');
  });
});

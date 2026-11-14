import { describe, expect, it } from 'vitest';
import { erroreDegliOrari, erroreDelleFasce } from '@/components/seller/orari-validi';

/** R23-015 — Il negozio aperto fino a mezzanotte scrive 18:00–00:00 e il salvataggio non lo ferma. */
describe('R23-015 — la chiusura a mezzanotte', () => {
  it('18:00–00:00 è valida', () => {
    expect(erroreDelleFasce([['18:00', '00:00']])).toBeNull();
    expect(erroreDegliOrari({ fri: [['18:00', '00:00']] })).toBeNull();
  });
  it('00:00–00:00 e le chiusure prima dell\'apertura restano errori', () => {
    expect(erroreDelleFasce([['00:00', '00:00']])).toMatch(/dopo quello di apertura/);
    expect(erroreDelleFasce([['13:00', '09:00']])).toMatch(/dopo quello di apertura/);
  });
  it('la fascia che arriva a mezzanotte si sovrappone a una che parte prima', () => {
    expect(erroreDelleFasce([['18:00', '00:00'], ['20:00', '22:00']])).toMatch(/sovrappongono/);
  });
  it('il messaggio dice come chiudere a mezzanotte', () => {
    expect(erroreDelleFasce([['16:30', '07:30']])).toMatch(/23:59/);
  });
});

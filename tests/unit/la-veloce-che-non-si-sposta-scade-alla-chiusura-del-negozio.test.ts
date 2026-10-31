import { describe, it, expect } from 'vitest';
import { ancoraNeiTempi, rigaScadenzaPerIlNegozio, scadenzaAccettazione } from '@/lib/ordini/scadenza-accettazione';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

/**
 * Il secondo freno della veloce (carta #220): se il negozio non conferma in 10 minuti la veloce cade.
 * Quando il freno non trova una fascia (sabato sera, forno chiuso la domenica) l'ordine restava
 * «Adesso» tre ore, con l'euro della veloce nel conto: alle 20:20 Maria leggeva «si annulla alle
 * 23:20», ma il forno chiude alle 21 e dopo nessuno può più accettarla.
 * Adesso la veloce scade alla chiusura del negozio, mai oltre le tre ore, e mai prima che il freno
 * abbia fatto i suoi giri.
 */
const lunSab: [string, string][] = [['08:00', '21:00']];
const forno = { mon: lunSab, tue: lunSab, wed: lunSab, thu: lunSab, fri: lunSab, sat: lunSab, sun: [] };
// Sabato 31/10/2026 alle 20:20 di Piacenza (UTC+1).
const veloce = { created_at: '2026-10-31T19:20:00.000Z', delivery_slot: ETICHETTA_ADESSO };

describe('la veloce che il freno non sposta scade alla chiusura del negozio, non dopo tre ore', () => {
  it('sabato 20:20 col forno aperto fino alle 21: scade alle 21:00, non alle 23:20', () => {
    expect(scadenzaAccettazione(veloce, undefined, forno)?.toISOString()).toBe('2026-10-31T20:00:00.000Z');
    expect(ancoraNeiTempi(veloce, new Date('2026-10-31T19:59:00.000Z'), forno)).toBe(true);
    // Il giro notturno delle 21:00 la annulla: prima la teneva viva fino alle 23:20.
    expect(ancoraNeiTempi(veloce, new Date('2026-10-31T20:00:00.000Z'), forno)).toBe(false);
  });

  it('il negozio legge la stessa ora del giro che annulla', () => {
    const riga = rigaScadenzaPerIlNegozio(veloce, new Date('2026-10-31T19:35:00.000Z'), forno);
    expect(riga).toContain('si annulla da solo alle 21:00 di oggi');
    expect(riga).not.toContain('23:20');
  });

  it('mai prima che il freno abbia fatto i suoi giri: la veloce delle 20:52 vive fino alle 21:12', () => {
    const tardi = { ...veloce, created_at: '2026-10-31T19:52:00.000Z' };
    expect(scadenzaAccettazione(tardi, undefined, forno)?.toISOString()).toBe('2026-10-31T20:12:00.000Z');
    expect(ancoraNeiTempi(tardi, new Date('2026-10-31T20:00:00.000Z'), forno)).toBe(true);
  });

  it('senza orari, col negozio aperto oltre le tre ore e sulle fasce non cambia niente', () => {
    expect(scadenzaAccettazione(veloce)?.toISOString()).toBe('2026-10-31T22:20:00.000Z');
    const tardissimo: [string, string][] = [['08:00', '23:59']];
    const sempre = { ...forno, sat: tardissimo };
    expect(scadenzaAccettazione(veloce, undefined, sempre)?.toISOString()).toBe('2026-10-31T22:20:00.000Z');
  });
});

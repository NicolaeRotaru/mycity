import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rigaScadenzaPerIlNegozio } from '@/lib/ordini/scadenza-accettazione';

/**
 * R18-015 — Col telefono del negozio un po' indietro, un ordine non più ritirabile leggeva
 * «Accettalo o rifiutalo entro le 12:46 di oggi» invece di «il ritiro non è più possibile».
 *
 * Lunedì 2/11/2026 da Pane Quotidiano (9-13, 16:30-19:30): l'ordine nasce alle 12:46:01 per
 * «Oggi · 13:00–16:30», e l'ultimo ritiro era alle 12:45. Il telefono del negozio segna le
 * 12:45:31 (trenta secondi indietro): per un ordine nato senza nessun momento per il ritiro la
 * riga deve dirlo comunque, qualunque ora segni il telefono.
 *
 * Orologio finto (l'ora del telefono) e fuso del processo diverso da quello di Roma.
 */

const giorno = [['09:00', '13:00'], ['16:30', '19:30']];
const ORARI_PQ = { mon: giorno, tue: giorno, wed: giorno, thu: [['09:00', '13:00']], fri: giorno, sat: giorno, sun: [] };

/** Lunedì 2/11/2026, ora di Roma (UTC+1). */
const roma = (h: number, m = 0, s = 0) => new Date(Date.UTC(2026, 10, 2, h - 1, m, s));
const NON_PIU_POSSIBILE = 'Il ritiro per questa fascia non è più possibile: l’ordine si sta annullando da solo.';
const fusoDiPrima = process.env.TZ;

beforeEach(() => {
  process.env.TZ = 'America/New_York';
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = fusoDiPrima;
});

describe('R18-015 — il ritiro non più possibile si dice anche col telefono indietro', () => {
  it('nato alle 12:46:01, telefono alle 12:45:31: niente «entro le 12:46»', () => {
    vi.setSystemTime(roma(12, 45, 31));
    const ordine = { created_at: roma(12, 46, 1).toISOString(), delivery_slot: 'Oggi · 13:00–16:30' };
    const riga = rigaScadenzaPerIlNegozio(ordine, new Date(), ORARI_PQ);
    expect(riga).not.toMatch(/entro le 12:46/);
    expect(riga).toBe(NON_PIU_POSSIBILE);
  });

  it('anche con l’ora presa dall’orologio del telefono (il valore di difetto di «adesso»)', () => {
    vi.setSystemTime(roma(12, 40));
    const ordine = { created_at: roma(12, 46, 1).toISOString(), delivery_slot: 'Oggi · 13:00–16:30' };
    expect(rigaScadenzaPerIlNegozio(ordine, undefined, ORARI_PQ)).toBe(NON_PIU_POSSIBILE);
  });

  it('un ordine ancora ritirabile resta com’era: nato alle 12:00, entro le 12:45', () => {
    vi.setSystemTime(roma(12, 0, 30));
    const ordine = { created_at: roma(12).toISOString(), delivery_slot: 'Oggi · 13:00–16:30' };
    expect(rigaScadenzaPerIlNegozio(ordine, new Date(), ORARI_PQ)).toBe('Accettalo o rifiutalo entro le 12:45 di oggi.');
  });
});

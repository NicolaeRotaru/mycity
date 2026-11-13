import { describe, it, expect } from 'vitest';
import { bozzaLetta, fasciaDaRimettere, giornoDaRimettere } from '@/lib/bozza-checkout';

/**
 * R03-025 — Chi ordina la sera per domani e conferma l'email la mattina dopo non si ritrova la
 * consegna spostata di un giorno.
 *
 * Lunedì 9/11 alle 22:30 (Piacenza) un ospite sceglie «Domani · 9:00–11:00», cioè martedì, e va
 * a registrarsi: la cassa salva la bozza in localStorage. Apre il link di conferma martedì alle
 * 08:15 e torna in cassa. Prima la bozza (senza data) rimetteva «Domani · 9:00–11:00» già
 * premuto e l'ordine nasceva per mercoledì. Ora «Domani» di ieri torna come «Oggi».
 * Orologio fisso: gli istanti sono scritti a mano, niente orologio vero.
 */

const LUNEDI_SERA = new Date('2026-11-09T21:30:00Z'); // 22:30 a Piacenza
const MARTEDI_MATTINA = new Date('2026-11-10T07:15:00Z'); // 08:15 a Piacenza
const MERCOLEDI_MATTINA = new Date('2026-11-11T07:15:00Z');

const salvata = (sceltaIl?: Date) => ({
  form: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121' },
  metodoPagamento: 'cod',
  giorno: 'tomorrow',
  fasciaOggi: 'Oggi · 19:30–21:00',
  fasciaDomani: 'Domani · 9:00–11:00',
  ...(sceltaIl ? { sceltaIl: sceltaIl.getTime() } : {}),
});

describe('R03-025 — la bozza della sera per domani', () => {
  it('salvata lunedì sera, letta martedì mattina: il giorno è oggi e la fascia «Oggi · 9:00–11:00»', () => {
    const b = bozzaLetta(JSON.parse(JSON.stringify(salvata(LUNEDI_SERA))), MARTEDI_MATTINA)!;
    expect(b.giorno, 'la cassa ripartirebbe con «Domani», cioè mercoledì').not.toBe('tomorrow');
    expect(b.giorno).toBe('today');
    expect(b.fasciaOggi).toBe('Oggi · 9:00–11:00');
    expect(b.fasciaDomani).toBeUndefined();
    // E la cassa, con le sue regole di sempre, non rimette nessun «Domani».
    expect(giornoDaRimettere(b.giorno, MARTEDI_MATTINA)).not.toBe('tomorrow');
    expect(fasciaDaRimettere('tomorrow', b.fasciaDomani, MARTEDI_MATTINA)).toBeNull();
    expect(b.form.address).toBe('Via Verdi 10');
  });

  it('letta due giorni dopo: la fascia di un giorno passato non torna', () => {
    const b = bozzaLetta(salvata(LUNEDI_SERA), MERCOLEDI_MATTINA)!;
    expect(b.giorno).toBeUndefined();
    expect(b.fasciaOggi).toBeUndefined();
    expect(b.fasciaDomani).toBeUndefined();
  });

  it('una bozza senza data non rimette giorno e fasce (non si sa di che giorno parla)', () => {
    const b = bozzaLetta(salvata(), MARTEDI_MATTINA)!;
    expect(b.giorno).toBeUndefined();
    expect(b.fasciaDomani).toBeUndefined();
    expect(b.metodoPagamento).toBe('cod');
  });

  it('salvata e letta lo stesso giorno: resta com era', () => {
    const b = bozzaLetta(salvata(LUNEDI_SERA), new Date('2026-11-09T21:40:00Z'))!;
    expect(b.giorno).toBe('tomorrow');
    expect(b.fasciaDomani).toBe('Domani · 9:00–11:00');
  });
});

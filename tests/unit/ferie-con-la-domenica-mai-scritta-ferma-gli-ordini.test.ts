/**
 * 31/10/2026 (ondata 3, secondo giro) — FERIE CON UN GIORNO MAI SCRITTO: LA CASSA SI FERMA LO STESSO.
 *
 * Pane Quotidiano ha gli orari da lunedì a sabato e la domenica non l'ha mai scritta (il forno la
 * domenica è chiuso). L'editor di prima scriveva solo il giorno toccato, e «Chiudi» compare solo
 * sui giorni aperti: per le ferie il negoziante chiude i sei giorni e sul database restano sei
 * liste vuote, senza `sun`. La regola del primo giro voleva tutti e sette i giorni presenti: martedì
 * 3/11 alle 10:00 l'ordine per «Domani · 9:00–11:00» passava, col forno chiuso per ferie.
 *
 * L'editor mostra un giorno mai scritto come chiuso: se il negoziante ha scritto la maggior parte
 * della settimana e ogni giorno scritto è chiuso, è chiuso. Due giorni vuoti e basta restano
 * «non lo so», come prima.
 *
 * Usa solo nomi che c'erano già: rossa sul codice di prima, verde con la regola nuova.
 */
import { describe, expect, it } from 'vitest';
import { isStoreClosedForOrder, negozioPuoServire } from '@/lib/store-hours';

/** Quello che resta a Pane Quotidiano dopo «Chiudi» sui sei giorni con l'editor di prima. */
const PANE_QUOTIDIANO_IN_FERIE = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };
/** Una pasticceria chiusa il lunedì (martedì-domenica), in ferie con l'editor di prima. */
const PASTICCERIA_IN_FERIE = { tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
/** Una parrucchiera martedì-sabato (chiusa domenica e lunedì), in ferie con l'editor di prima. */
const PARRUCCHIERA_IN_FERIE = { tue: [], wed: [], thu: [], fri: [], sat: [] };

const MARTEDI_10 = new Date('2026-11-03T10:00:00');
const SABATO_10 = new Date('2026-10-31T10:00:00');
const DOMANI = 'Domani · 9:00–11:00';
const OGGI = 'Oggi · 16:30–18:00';

describe('ferie con un giorno mai scritto: nessun ordine passa', () => {
  it('IL CASO: Pane Quotidiano senza domenica, martedì 3/11 alle 10 per domani', () => {
    expect(negozioPuoServire(PANE_QUOTIDIANO_IN_FERIE, DOMANI, MARTEDI_10)).toBe(false);
    expect(negozioPuoServire(PANE_QUOTIDIANO_IN_FERIE, OGGI, MARTEDI_10)).toBe(false);
    expect(negozioPuoServire(PANE_QUOTIDIANO_IN_FERIE, null, MARTEDI_10)).toBe(false);
    expect(isStoreClosedForOrder(PANE_QUOTIDIANO_IN_FERIE, MARTEDI_10)).toBe(true);
  });

  it('sabato 31/10 per domani (la domenica mai scritta) non passa', () => {
    expect(negozioPuoServire(PANE_QUOTIDIANO_IN_FERIE, DOMANI, SABATO_10)).toBe(false);
    expect(isStoreClosedForOrder(PANE_QUOTIDIANO_IN_FERIE, SABATO_10)).toBe(true);
  });

  it('vale per qualunque giorno di riposo, non solo la domenica', () => {
    for (const ferie of [PASTICCERIA_IN_FERIE, PARRUCCHIERA_IN_FERIE]) {
      expect(negozioPuoServire(ferie, DOMANI, MARTEDI_10), JSON.stringify(ferie)).toBe(false);
      expect(isStoreClosedForOrder(ferie, MARTEDI_10), JSON.stringify(ferie)).toBe(true);
    }
  });

  it('un giorno o due vuoti e basta restano «non lo so»: nessun blocco, come prima', () => {
    for (const poco of [{ tue: [] }, { sun: [], mon: [] }]) {
      expect(negozioPuoServire(poco, DOMANI, MARTEDI_10), JSON.stringify(poco)).toBe(true);
      expect(isStoreClosedForOrder(poco, MARTEDI_10), JSON.stringify(poco)).toBe(false);
    }
  });

  it('Pane Quotidiano aperto, senza domenica, continua a servire', () => {
    const giornata = [['09:00', '13:00'], ['16:30', '19:30']];
    const aperto = { mon: giornata, tue: giornata, wed: giornata, thu: [['09:00', '13:00']], fri: giornata, sat: giornata };
    expect(negozioPuoServire(aperto, DOMANI, MARTEDI_10)).toBe(true);
    expect(isStoreClosedForOrder(aperto, MARTEDI_10)).toBe(false);
  });
});

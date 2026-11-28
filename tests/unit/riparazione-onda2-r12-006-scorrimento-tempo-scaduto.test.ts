/**
 * R12-006 (onda 2) — UN TEMPO SCADUTO A PAGINA 2 NON MESCOLA DUE ORDINI.
 *
 * Prezzo crescente, due per pagina. Sul prezzo pagato (12 € al -25% = 9 €): otto, dodici-al-25 |
 * nove-e-99, dieci. Sul prezzo pieno: otto, nove-e-99 | dieci, dodici-al-25.
 * L'onda 1 fa leggere le pagine dopo la prima come la prima. Restava il ripiego: un 57014 sulla
 * pagina 2 (letta sul pagato come la 1) la rileggeva sul pieno, e usciva [dieci, dodici-al-25]:
 * dodici-al-25 due volte, nove-e-99 mai (sonda del revisore). Adesso la pagina 2 rilancia l'errore
 * («Carica altri» mostra «riprova») e, ripresa, continua sul prezzo pagato.
 * Orologio finto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leggiProdottiDellaGriglia, type DomandaGriglia } from '@/lib/queries/griglia-prodotti';
import { NEGOZIO, fintoPrezzoPagato, prodotto, type StatoFinto } from './aiuti/riparazione-r12-finto-prezzo-pagato';

const TABELLE = {
  seller_public_profiles: [NEGOZIO],
  products: [prodotto('otto', 8), prodotto('nove-e-99', 9.99), prodotto('dieci', 10), prodotto('dodici-al-25', 12)],
};
const SCONTI = { 'dodici-al-25': 25 };
const pagina = (da: number): DomandaGriglia => ({ sort: 'price_asc', tetto: 2, finestra: [da, da + 1] });
const ids = (righe: Array<{ id: string }>) => righe.map((r) => r.id);
const TEMPO_SCADUTO = { code: '57014', message: 'canceling statement due to statement timeout' };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-28T10:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('uno scorrimento letto sul prezzo pagato resta sul prezzo pagato', () => {
  it('57014 alla pagina 2: niente pagina sul prezzo pieno, errore; ripresa, la pagina 2 e quella giusta', async () => {
    let scade = false;
    const stato: StatoFinto = { conColonna: true, guasto: (d) => (scade && d.prezzoPagato ? TEMPO_SCADUTO : null) };
    const db = fintoPrezzoPagato(TABELLE, SCONTI, stato);
    const prima = await leggiProdottiDellaGriglia(db.client, pagina(0));
    expect(ids(prima)).toEqual(['otto', 'dodici-al-25']);

    scade = true;
    let seconda: Array<{ id: string }> | null = null;
    let errore: unknown = null;
    try {
      seconda = await leggiProdottiDellaGriglia(db.client, pagina(2));
    } catch (e) {
      errore = e;
    }
    expect(
      seconda && ids(seconda),
      'la pagina 2 e stata letta sul prezzo pieno dopo una pagina 1 sul pagato: due ordini mescolati',
    ).toBeNull();
    expect(errore).toMatchObject({ code: '57014' });

    // «Riprova»: il database ha ripreso fiato, la pagina 2 continua nell'ordine della prima.
    scade = false;
    const ripresa = await leggiProdottiDellaGriglia(db.client, pagina(2));
    expect(ids(ripresa)).toEqual(['nove-e-99', 'dieci']);
    expect(new Set([...ids(prima), ...ids(ripresa)]).size).toBe(4);
  });

  it('il segno dei cinque minuti acceso da un altro scorrimento non fa passare questo al prezzo pieno', async () => {
    let scade = false;
    const stato: StatoFinto = { conColonna: true, guasto: (d) => (scade && d.prezzoPagato ? TEMPO_SCADUTO : null) };
    const db = fintoPrezzoPagato(TABELLE, SCONTI, stato);
    const prima = await leggiProdottiDellaGriglia(db.client, pagina(0));
    expect(ids(prima)).toEqual(['otto', 'dodici-al-25']);

    // Un'altra griglia (filtro di prezzo) va in tempo scaduto e ripiega: il segno si accende.
    scade = true;
    await leggiProdottiDellaGriglia(db.client, { sort: 'newest', tetto: 2, maxPrice: 20, finestra: [0, 1] });

    let seconda: Array<{ id: string }> | null = null;
    try {
      seconda = await leggiProdottiDellaGriglia(db.client, pagina(2));
    } catch {
      seconda = null;
    }
    expect(seconda && ids(seconda), 'la pagina 2 e passata al prezzo pieno dopo una pagina 1 sul pagato').toBeNull();

    // Un nuovo scorrimento, col segno acceso, decide di nuovo: sul prezzo pieno, coerente con se stesso.
    expect(ids(await leggiProdottiDellaGriglia(db.client, pagina(0)))).toEqual(['otto', 'nove-e-99']);
    expect(ids(await leggiProdottiDellaGriglia(db.client, pagina(2)))).toEqual(['dieci', 'dodici-al-25']);
  });

  it('la prima pagina in tempo scaduto ripiega ancora sul prezzo pieno, e le pagine dopo la seguono', async () => {
    let scade = true;
    const stato: StatoFinto = { conColonna: true, guasto: (d) => (scade && d.prezzoPagato ? TEMPO_SCADUTO : null) };
    const db = fintoPrezzoPagato(TABELLE, SCONTI, stato);
    expect(ids(await leggiProdottiDellaGriglia(db.client, pagina(0)))).toEqual(['otto', 'nove-e-99']);
    scade = false;
    expect(ids(await leggiProdottiDellaGriglia(db.client, pagina(2)))).toEqual(['dieci', 'dodici-al-25']);
  });
});

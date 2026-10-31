/**
 * 31/10/2026 (sesta ondata, secondo giro) — LA SCHEDA DI UN PRODOTTO ESCLUSO
 * DAL RECESSO NON PROMETTE IL RESO.
 *
 * La torta su ordinazione che il forno ha segnato come esclusa (fatto
 * `legale.recesso-esclusi`, migrazione 180) mostrava sulla scheda «Reso entro
 * 14 giorni, esclusi i prodotti freschi e deperibili»: la cliente legge il
 * numero. Ora la frase della scheda viene da lib/promesse-pubbliche.ts e,
 * per il prodotto escluso, dice cosa resta: la garanzia.
 */
import { describe, it, expect } from 'vitest';
import * as promesse from '@/lib/promesse-pubbliche';

type FraseDelProdotto = (p: { non_recedibile?: unknown } | null | undefined) => string;
// La frase della scheda per UN prodotto. Sulla base la scheda mostrava FRASE_RESO a tutti.
const frase = (p: { non_recedibile?: unknown } | null | undefined): string =>
  ((promesse as Record<string, unknown>).fraseResoDelProdotto as FraseDelProdotto | undefined)?.(p) ?? promesse.FRASE_RESO;

describe('la frase del reso sulla scheda prodotto', () => {
  it('IL CASO CHE ROMPEVA — la torta esclusa dal recesso non dice «Reso entro 14 giorni»', () => {
    const t = frase({ non_recedibile: true });
    expect(t, 'la scheda della torta esclusa promette ancora il reso').not.toMatch(/Reso entro 14 giorni/i);
    expect(t).toMatch(/escluso dal recesso/i);
    expect(t).toMatch(/garanzia/i);
  });

  it('controprova: il miele (non escluso) e il prodotto prima della 180 tengono la frase generale', () => {
    expect(frase({ non_recedibile: false })).toBe(promesse.FRASE_RESO);
    expect(frase({})).toBe(promesse.FRASE_RESO);
    expect(frase(null)).toBe(promesse.FRASE_RESO);
    expect(promesse.FRASE_RESO).toMatch(/esclusi i prodotti freschi/);
  });
});

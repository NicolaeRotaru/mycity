import { MAX_ALT_TEXT, MAX_VALORE_ATTRIBUTO } from '@/lib/products/draftFromVision';
import {
  MAX_NOME_PRODOTTO,
  MAX_DESCRIZIONE_PRODOTTO,
  chiaveCampo,
  eCampoDichiarativo,
} from '@/lib/products/aiPatch';

/**
 * I tetti di lunghezza delle bozze nate dalle foto, controllati PRODOTTO PER
 * PRODOTTO (S10, 5/11/2026). Un tetto nello schema zod della richiesta faceva
 * rispondere 400 a tutto il lotto per un solo campo lungo; qui chi lo supera
 * si sente dire quale campo, e gli altri prodotti nascono.
 *
 * Ingredienti e valori nutrizionali arrivano fino a 2000 caratteri (scelta di
 * Nicola, vedi catalog-create-bulk); gli altri attributi a 500.
 */
export const MAX_VALORE_LUNGO = 2000;
const CAMPI_LUNGHI = new Set(['ingredienti', 'valori_nutrizionali']);

/**
 * `buildDraftProductInsert` taglia ogni attributo a 500: per ingredienti e
 * valori nutrizionali entrati nella bozza rimette il testo intero (gia'
 * controllato sotto i 2000 con `campoOltreIlTetto`).
 */
export function rimettiIValoriLunghi(
  inBozza: Record<string, unknown>,
  dallaRichiesta: Record<string, string> | undefined,
): void {
  for (const [chiaveAi, grezzo] of Object.entries(dallaRichiesta ?? {})) {
    const chiave = chiaveCampo(chiaveAi);
    if (CAMPI_LUNGHI.has(chiave) && chiave in inBozza) inBozza[chiave] = String(grezzo).trim();
  }
}

export function tettoDelCampo(chiaveAi: string): number {
  return CAMPI_LUNGHI.has(chiaveCampo(chiaveAi)) ? MAX_VALORE_LUNGO : MAX_VALORE_ATTRIBUTO;
}

/**
 * Il primo attributo che supera il suo tetto, oppure null. Senza la spunta
 * delle dichiarazioni, allergeni e ingredienti non entrano comunque nella
 * bozza (`buildDraftProductInsert`): un loro valore lungo non scarta niente.
 */
export function campoOltreIlTetto(
  attributes: Record<string, string> | undefined,
  opts: { dichiarazioniConfermate?: boolean } = {},
): { campo: string; tetto: number } | null {
  for (const [chiave, valore] of Object.entries(attributes ?? {})) {
    if (!opts.dichiarazioniConfermate && eCampoDichiarativo(chiave)) continue;
    const tetto = tettoDelCampo(chiave);
    if (String(valore).trim().length > tetto) return { campo: chiave, tetto };
  }
  return null;
}

type TestiDellaBozza = {
  name?: string;
  description?: string;
  alt_text?: string | null;
  tags?: string[];
};

/** Il primo testo della bozza (nome, descrizione, testo alternativo, tag) oltre il tetto. */
export function testoOltreIlTetto(draft: TestiDellaBozza): { campo: string; tetto: number } | null {
  if ((draft.name ?? '').length > MAX_NOME_PRODOTTO * 4) return { campo: 'nome', tetto: MAX_NOME_PRODOTTO * 4 };
  if ((draft.description ?? '').length > MAX_DESCRIZIONE_PRODOTTO * 2) {
    return { campo: 'descrizione', tetto: MAX_DESCRIZIONE_PRODOTTO * 2 };
  }
  if ((draft.alt_text ?? '').length > MAX_ALT_TEXT) return { campo: 'testo alternativo', tetto: MAX_ALT_TEXT };
  if ((draft.tags ?? []).some((t) => t.length > 60)) return { campo: 'tag', tetto: 60 };
  return null;
}

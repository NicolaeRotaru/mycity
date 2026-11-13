// lib/ai/regolaCopilot.ts
import { BANDA_PREZZO_AI, type AiProductPatch } from '@/lib/products/aiPatch';

/** Quanti tag tiene un prodotto (lo stesso tetto di resolveAiPatch). */
const MAX_TAG = 15;

/**
 * 12/11/2026 (R04-007) — UNA MODIFICA UGUALE SU TANTI PRODOTTI, DETTA UNA VOLTA.
 *
 * Il copilot scriveva una voce {product_id, patch} per ogni prodotto: 35-55
 * token l'una. Oltre un centinaio di prodotti la risposta non entrava nel
 * tetto (6000 token, legato al minuto di attesa del client) e il negoziante
 * leggeva «Riprova» a ogni tentativo. Adesso, per la stessa operazione su
 * molti prodotti, il modello manda una REGOLA — gli id e l'operazione — e il
 * nuovo valore lo calcola il server: il prezzo con la percentuale, i tag a
 * partire da quelli veri del prodotto (che il modello nell'elenco non vede).
 */
export type RegolaCopilot = {
  product_ids?: unknown;
  prezzo_percentuale?: unknown;
  aggiungi_tag?: unknown;
  togli_tag?: unknown;
  status?: unknown;
};

type ProdottoPerRegola = { id: string; price: number | string | null; tags?: string[] | null };

const STATI = new Set(['available', 'draft', 'sold']);

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function elencoTag(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().toLowerCase().slice(0, 40))
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * Traduce la regola in una modifica per prodotto. Prende solo gli id che sono
 * del venditore; un'operazione scritta male si salta (non si indovina).
 */
export function espandiRegolaCopilot(
  regola: RegolaCopilot | null | undefined,
  prodotti: ProdottoPerRegola[],
  massimo: number,
): { product_id: string; patch: AiProductPatch }[] {
  if (!regola || typeof regola !== 'object' || !Array.isArray(regola.product_ids)) return [];
  const perId = new Map(prodotti.map((p) => [p.id, p]));
  // R04-007 (revisione) — Una percentuale oltre la banda del ±30% il server non
  // la applica mai: non si propone nemmeno (prima si vedeva un prezzo assurdo,
  // rifiutato solo dopo «Applica»).
  const pct =
    typeof regola.prezzo_percentuale === 'number' &&
    Number.isFinite(regola.prezzo_percentuale) &&
    Math.abs(regola.prezzo_percentuale) <= BANDA_PREZZO_AI * 100
      ? regola.prezzo_percentuale
      : null;
  const aggiungi = elencoTag(regola.aggiungi_tag);
  const togli = new Set(elencoTag(regola.togli_tag));
  const stato = typeof regola.status === 'string' && STATI.has(regola.status) ? regola.status : null;

  const visti = new Set<string>();
  const fuori: { product_id: string; patch: AiProductPatch }[] = [];
  for (const id of regola.product_ids) {
    if (fuori.length >= massimo) break;
    if (typeof id !== 'string' || visti.has(id)) continue;
    const p = perId.get(id);
    if (!p) continue;
    visti.add(id);
    const patch: AiProductPatch = {};
    // Il prezzo dal database puo' arrivare come testo («20.00»).
    const prezzo = p.price == null ? NaN : Number(p.price);
    if (pct !== null && Number.isFinite(prezzo) && prezzo > 0) {
      const nuovo = round2(prezzo * (1 + pct / 100));
      if (nuovo > 0 && nuovo !== prezzo) patch.price = nuovo;
    }
    if (aggiungi.length > 0 || togli.size > 0) {
      const attuali = Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [];
      const nuovi = Array.from(new Set([...attuali.filter((t) => !togli.has(t.toLowerCase())), ...aggiungi]));
      const cambiati = nuovi.length !== attuali.length || nuovi.some((t, i) => t !== attuali[i]);
      // Oltre i 15 tag il server taglia gli ultimi, cioe' proprio quelli
      // aggiunti, e dice «applicato»: su quel prodotto i tag non si propongono.
      if (cambiati && nuovi.length <= MAX_TAG) patch.tags = nuovi;
    }
    if (stato) patch.status = stato;
    if (Object.keys(patch).length > 0) fuori.push({ product_id: id, patch });
  }
  return fuori;
}

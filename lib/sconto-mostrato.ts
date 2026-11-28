import { discountedUnitCents } from '@/lib/promotions';

/**
 * R10-004 (onda 2) — COSA SI MOSTRA DI UNO SCONTO: UNA REGOLA SOLA.
 *
 * Scheda delle griglie, pagina del prodotto, bollino «In promo» e anteprima del negoziante facevano
 * il conto ognuna a modo suo, e nessuna guardava se lo sconto si vedeva davvero nel prezzo:
 *  - con uno sconto sotto lo 0,5% la percentuale arrotondata è 0 e usciva il bollino «-0%»
 *    (o «In promo -0%»);
 *  - su un prezzo piccolo lo scontato arrotondato al centesimo è uguale al pieno (1,00 € al -0,3%
 *    resta 1,00 €), e accanto al prezzo compariva lo stesso prezzo barrato, con «Risparmi 0,00 €»;
 *  - un prezzo di listino appena sopra il prezzo (100,002 contro 100) barrava «100,00 €» accanto a
 *    «100,00 €».
 *
 * La regola: il barrato c'è solo se il prezzo che si paga, in centesimi, è minore di quello barrato;
 * la percentuale solo se c'è il barrato e arrotondata non è zero. Con la promozione attiva il listino
 * non si guarda (R18-006: due prezzi barrati e un «Risparmi» sul pieno). Lo scontato è quello della
 * cassa (`discountedUnitCents`: al centesimo, sconto fra 0 e 70), e la percentuale della promo è
 * quella applicata davvero (R16-006: su 100 € lo scontato in centesimi dice lo sconto, tetto
 * compreso).
 */
export type ScontoMostrato = {
  /** Il prezzo che si paga, in centesimi. */
  prezzoCents: number;
  /** Il prezzo barrato in centesimi, o null se non c'è niente da barrare. */
  barratoCents: number | null;
  /** La percentuale del bollino, o null se non c'è bollino (mai 0). */
  percento: number | null;
  /** Da dove viene il barrato: la promozione del negozio o il prezzo di listino. */
  origine: 'promo' | 'listino' | null;
};

const centesimi = (euro: number | string | null | undefined): number => {
  const n = Number(euro);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function scontoMostrato({
  prezzo,
  scontoPercento,
  prezzoDiListino,
}: {
  /** Il prezzo pieno del prodotto, in euro. */
  prezzo: number | string;
  /** Lo sconto della promozione attiva, in percento (0 o assente: nessuna promozione). */
  scontoPercento?: number | null;
  /** Il prezzo di listino barrato del negoziante (compare_at_price), in euro. */
  prezzoDiListino?: number | string | null;
}): ScontoMostrato {
  const pienoCents = centesimi(prezzo);
  const promo = Number(scontoPercento) > 0 ? Number(scontoPercento) : 0;

  if (promo > 0) {
    const prezzoCents = discountedUnitCents(prezzo, promo);
    if (prezzoCents >= pienoCents) return { prezzoCents: pienoCents, barratoCents: null, percento: null, origine: null };
    const pct = Math.round(100 - discountedUnitCents(100, promo) / 100);
    return { prezzoCents, barratoCents: pienoCents, percento: pct > 0 ? pct : null, origine: 'promo' };
  }

  const listinoCents = prezzoDiListino == null ? 0 : centesimi(prezzoDiListino);
  if (pienoCents > 0 && listinoCents > pienoCents) {
    const pct = Math.round((1 - pienoCents / listinoCents) * 100);
    return { prezzoCents: pienoCents, barratoCents: listinoCents, percento: pct > 0 ? pct : null, origine: 'listino' };
  }
  return { prezzoCents: pienoCents, barratoCents: null, percento: null, origine: null };
}

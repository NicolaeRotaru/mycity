import { giornoPiacenza, ultimiGiorniPiacenza } from '@/lib/tempo-piacenza';

/**
 * L'INCASSO GIORNO PER GIORNO, CON I GIORNI DI PIACENZA.
 *
 * 27/8/2026 (R174). Il grafico dei guadagni del negoziante costruiva le colonne
 * con `toISOString().slice(0, 10)` e confrontava le date degli ordini allo
 * stesso modo: cioè tagliava le giornate a mezzanotte di Greenwich. D'estate
 * l'Italia è due ore avanti, quindi ogni ordine fatto fra mezzanotte e le due —
 * che per un marketplace di cibo non è una fascia vuota — finiva nella colonna
 * del giorno prima.
 *
 * `lib/tempo-piacenza.ts` esiste esattamente per questo, e tutte le altre
 * pagine dei numeri lo usano già. La pagina Guadagni no: lo stesso ordine
 * compariva in due giorni diversi a seconda di quale cruscotto apriva il
 * negoziante, e due cruscotti che si contraddicono valgono meno di uno solo.
 *
 * Il conto sta qui e non dentro la pagina perché sono i soldi di una persona:
 * si prova fuori dal componente, come già si fa per il riepilogo del negozio.
 */
export type OrdineDelGrafico = {
  created_at: string;
  total_price: number | string;
};

/**
 * Le ultime `quantiGiorni` giornate (di Piacenza) con l'incasso di ciascuna,
 * dalla più vecchia a oggi. I giorni senza ordini restano a zero: il grafico
 * deve avere tutte le sue colonne.
 */
export function incassoPerGiorno(
  ordini: ReadonlyArray<OrdineDelGrafico>,
  quantiGiorni = 7,
  adesso: Date = new Date(),
): Array<[string, number]> {
  const giorni: Record<string, number> = {};
  for (const g of ultimiGiorniPiacenza(quantiGiorni, adesso)) giorni[g] = 0;
  for (const o of ordini) {
    const g = giornoPiacenza(o.created_at);
    if (g in giorni) giorni[g] += Number(o.total_price);
  }
  return Object.entries(giorni);
}

/**
 * Cosa vuol dire «fatturato» per un negozio, deciso una volta.
 *
 * Perché serve questo file: le tre pagine del venditore ne davano tre
 * definizioni diverse, e mostravano tre numeri diversi per lo stesso mese.
 *
 *   · Riepilogo  → somma di prezzo × quantità di TUTTI gli articoli, senza
 *     guardare lo stato dell'ordine: dentro c'erano anche gli annullati e i non
 *     pagati. Il numero più alto dei tre, quello che si guarda con piacere.
 *   · Andamento  → somma del totale degli ordini CONSEGNATI, spedizione e quota
 *     di consegna comprese: cioè soldi che non sono del negozio.
 *   · Incassi    → somma del totale, meno la commissione: l'unico dei tre vicino
 *     a quello che arriva in banca.
 *
 * Con tre numeri il negoziante non sa a quale credere, e chi decide i prezzi
 * neanche. Qui si fissano due grandezze, distinte e dette per nome:
 *
 *   incassato     = quanto ha incassato il marketplace su quegli ordini (lordo),
 *                   MENO quello che è tornato indietro al cliente
 *   tuoNetto      = quanto resta al negozio, togliendo commissione, spedizione
 *                   e quota di consegna
 *
 * Regola comune: si contano SOLO gli ordini pagati e non annullati. Un ordine
 * annullato non è fatturato di nessuno.
 *
 * 3/9/2026 — E il rimborso scende dall'incassato. Prima no: un ordine da 100 €
 * rimborsato per 40 restava 100 qui dentro, mentre la pagina Guadagni lo
 * contava 60. Il negoziante vedeva due cifre diverse per lo stesso mese, e
 * quella grossa era quella falsa.
 */

export type OrdinePerMetriche = {
  total_price: number | string | null;
  delivery_status?: string | null;
  payment_status?: string | null;
  application_fee_cents?: number | null;
  shipping_cost?: number | string | null;
  delivery_fee_cents?: number | null;
  /**
   * Quanto e' tornato indietro al cliente su questo ordine, in centesimi.
   *
   * 3/9/2026 — QUESTO CAMPO NON C'ERA, E PER COSTRUZIONE LA METRICA NON POTEVA
   * SAPERE DEI RIMBORSI. Un ordine da 100 euro rimborsato per 40 entrava per
   * 100: il cruscotto del negozio mostrava 40 euro che il negozio non ha, e la
   * pagina Guadagni — che il rimborso lo sottraeva — ne mostrava un altro.
   * Stesso mese, stesso negozio, due cifre diverse in due pagine dello stesso
   * pannello.
   */
  refunded_amount_cents?: number | null;
  created_at?: string | null;
};

/** Un ordine conta nel fatturato? */
export function ordineContaNelFatturato(o: OrdinePerMetriche): boolean {
  const annullato = o.delivery_status === 'CANCELED';
  const pagato = o.payment_status === 'PAID' || o.payment_status === 'PARTIALLY_REFUNDED';
  return !annullato && pagato;
}

function cent(v: number | string | null | undefined): number {
  return Math.round(Number(v ?? 0) * 100);
}

/**
 * QUANTO E' ENTRATO DAVVERO SU UN ORDINE — la definizione, una sola volta.
 *
 * Il totale che il cliente ha pagato, meno quello che gli e' stato restituito.
 * Sotto zero non si va: un rimborso non puo' generare un debito del negozio.
 *
 * Questa riga esisteva gia', ma in un altro file (lib/guadagni/negozio.ts) e
 * solo li'. Il cruscotto e la pagina Andamento sommavano `total_price` intero,
 * quindi lo stesso mese usciva con due cifre diverse a seconda della pagina
 * aperta. Adesso il conto e' scritto qui e lo chiamano tutti: perche' due
 * numeri tornino a divergere bisognerebbe scrivere una seconda formula, e la
 * prova in tests/unit/il-rimborso-al-cliente-scende-dai-guadagni-del-negozio
 * diventa rossa se qualcuno ci prova.
 */
export function incassatoDellOrdineCents(o: OrdinePerMetriche): number {
  return Math.max(0, cent(o.total_price) - (o.refunded_amount_cents ?? 0));
}

export type MetricheVenditore = {
  /** Ordini contati. */
  ordini: number;
  /** Totale incassato dal marketplace su quegli ordini, in centesimi. */
  incassatoCents: number;
  /** Quanto resta al negozio, in centesimi. */
  tuoNettoCents: number;
  /** Commissione trattenuta da MyCity, in centesimi. */
  commissioneCents: number;
};

/**
 * Calcola le metriche su un insieme di ordini del venditore.
 * `da` e `a` (opzionali) filtrano per data di creazione.
 */
export function metricheVenditore(
  ordini: OrdinePerMetriche[],
  da?: Date,
  a?: Date,
): MetricheVenditore {
  let incassatoCents = 0;
  let commissioneCents = 0;
  let nonDelNegozioCents = 0;
  let contati = 0;

  for (const o of ordini) {
    if (!ordineContaNelFatturato(o)) continue;
    if (da || a) {
      const quando = o.created_at ? new Date(o.created_at) : null;
      if (!quando) continue;
      if (da && quando < da) continue;
      if (a && quando >= a) continue;
    }
    contati += 1;
    incassatoCents += incassatoDellOrdineCents(o);
    commissioneCents += o.application_fee_cents ?? 0;
    // Spedizione e quota di consegna non sono soldi del negozio: la prima va al
    // fattorino, la seconda alla piattaforma.
    nonDelNegozioCents += cent(o.shipping_cost) + (o.delivery_fee_cents ?? 0);
  }

  return {
    ordini: contati,
    incassatoCents,
    commissioneCents,
    tuoNettoCents: Math.max(0, incassatoCents - commissioneCents - nonDelNegozioCents),
  };
}

/**
 * I TOTALI DI SEMPRE, MA SOLO SE CHI LI HA SOMMATI SAPEVA DEI RIMBORSI.
 *
 * I numeri «dall'inizio» del cruscotto non li somma il browser — che legge solo
 * gli ultimi trenta giorni — ma il database, con `numeri_del_negozio`. Quella
 * funzione è stata scritta prima di questo difetto e somma `total_price`
 * intero: i rimborsi non li ha mai visti.
 *
 * Qui c'è il cancello. Se dal database non arriva anche quanto è stato
 * rimborsato, i suoi totali NON si mostrano: si ripiega su quello che il
 * browser sa calcolare bene. È un numero più basso del vero — copre trenta
 * giorni invece di sempre — ma è un numero vero. Al contrario, un totale che
 * per costruzione non può aver tolto i rimborsi è più alto del vero, e su
 * quello il negoziante decide se restare con noi.
 *
 * Quando la migrazione che insegna i rimborsi a `numeri_del_negozio` sarà
 * firmata e applicata, questo cancello si apre da solo: nessun codice da
 * cambiare.
 */
export type NumeriDalDatabase = {
  incasso_totale_cents?: number | null;
  commissione_totale_cents?: number | null;
  non_del_negozio_cents?: number | null;
  /** La prova che chi ha sommato sapeva dei rimborsi. Se manca, non ci si fida. */
  rimborsi_totali_cents?: number | null;
} | null | undefined;

export type TotaliVenditore = Pick<MetricheVenditore, 'incassatoCents' | 'tuoNettoCents'>;

export function totaliDiSempre(
  numeri: NumeriDalDatabase,
  ripiego: TotaliVenditore,
): TotaliVenditore {
  if (!numeri || numeri.rimborsi_totali_cents == null) return ripiego;
  const incassatoCents = numeri.incasso_totale_cents ?? 0;
  return {
    incassatoCents,
    tuoNettoCents: Math.max(
      0,
      incassatoCents
        - (numeri.commissione_totale_cents ?? 0)
        - (numeri.non_del_negozio_cents ?? 0),
    ),
  };
}

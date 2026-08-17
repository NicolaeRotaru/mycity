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
 *   incassato     = quanto ha incassato il marketplace su quegli ordini (lordo)
 *   tuoNetto      = quanto resta al negozio, togliendo commissione, spedizione
 *                   e quota di consegna
 *
 * Regola comune: si contano SOLO gli ordini pagati e non annullati. Un ordine
 * annullato non è fatturato di nessuno.
 */

export type OrdinePerMetriche = {
  total_price: number | string | null;
  delivery_status?: string | null;
  payment_status?: string | null;
  application_fee_cents?: number | null;
  shipping_cost?: number | string | null;
  delivery_fee_cents?: number | null;
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
    incassatoCents += cent(o.total_price);
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

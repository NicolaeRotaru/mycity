/**
 * LA MERCE CHE STO GIÀ TENENDO IO NON È MERCE FINITA.
 *
 * ── Il difetto che ha prodotto questo file ──────────────────────────────────
 * Premendo «Paga con carta» il server scala subito la giacenza (`reserve_stock`
 * scrive davvero su `products.stock`) e apre la pagina di Stripe. Chi lì fa
 * indietro torna in cassa e trova zero pezzi: quell'ultimo pezzo lo ha
 * impegnato lui un minuto prima, e la riserva vive due ore.
 *
 * Il rilascio esiste — `lib/ordini/riserve-abbandonate.ts`, e le due rotte
 * d'ordine lo chiamano prima di riservare — ma non veniva mai raggiunto: la
 * cassa vedeva «richiesti 1, disponibili 0», spegneva il pulsante d'ordine e
 * `handleSubmit` usciva prima di chiamare il server. La riparazione stava
 * dietro un cancello che si chiudeva prima. Risultato: per due ore quel
 * cliente non poteva ricomprare la cosa che aveva scelto, e nessun altro
 * poteva comprarla — il pezzo era invisibile a tutto il marketplace. L'unica
 * via d'uscita offerta era «Togli dal carrello», cioè rinunciare.
 *
 * ── La regola ───────────────────────────────────────────────────────────────
 * La disponibilità NON è un numero solo: dipende da chi guarda. Per un estraneo
 * l'ultimo pezzo impegnato è finito; per chi lo sta tenendo è ancora suo. Qui la
 * cassa conta anche quello che questa stessa persona ha impegnato con un
 * tentativo ancora aperto, così la richiesta arriva al server — che libera la
 * riserva vecchia e riserva quella nuova, come sa già fare.
 *
 * ⚠️ Si contano i tentativi in stato PENDING, e solo quelli: sono esattamente
 * le righe che `liberaRiserveAbbandonate` libererà. Il browser non deve
 * promettere una disponibilità che il server non conferma. (Anche una riga
 * PENDING già scaduta tiene ancora la merce finché qualcuno non la libera:
 * infatti nemmeno il server guarda `expires_at` quando decide cosa liberare.)
 *
 * 🟢 Puro: nessuna rete, nessun orologio.
 */

/** Una riga di `pending_checkouts`, letta per il poco che serve qui. */
export type TentativoAperto = {
  groups?: Array<{
    items?: Array<{ productId: string; quantity: number; variantId?: string | null }>;
  }> | null;
};

/** Prodotto + variante: la stessa coppia con cui la cassa legge le giacenze. */
export function chiaveDellaRiga(productId: string, variantId?: string | null): string {
  return `${productId}::${variantId ?? ''}`;
}

/** Quanti pezzi di ogni riga sono impegnati da tentativi ancora aperti di questa persona. */
export function merceCheTengoIo(tentativi: TentativoAperto[]): Map<string, number> {
  const tenuta = new Map<string, number>();
  for (const tentativo of tentativi ?? []) {
    for (const gruppo of tentativo.groups ?? []) {
      for (const riga of gruppo.items ?? []) {
        if (!riga?.productId) continue;
        const quantita = Number(riga.quantity);
        if (!Number.isFinite(quantita) || quantita <= 0) continue;
        const chiave = chiaveDellaRiga(riga.productId, riga.variantId);
        tenuta.set(chiave, (tenuta.get(chiave) ?? 0) + quantita);
      }
    }
  }
  return tenuta;
}

export type RigaDaControllare = {
  id: string;
  name: string;
  quantity: number;
  variantId?: string | null;
};

export type ProblemaDiDisponibilita = {
  id: string;
  name: string;
  requested: number;
  /** Quello che questa persona può davvero avere: lo scaffale più ciò che tiene lei. */
  available: number;
};

/**
 * Le righe del carrello che superano la disponibilità — viste dagli occhi di
 * chi sta comprando, non da quelli di un estraneo.
 *
 * `disponibileAScaffale` è la giacenza letta dal database (variante se c'è,
 * altrimenti prodotto): è già scalata dalle riserve, comprese le proprie.
 */
export function problemiDiDisponibilita<T extends RigaDaControllare>(
  righe: T[],
  disponibileAScaffale: (riga: T) => number,
  tengoIo: Map<string, number> = new Map(),
): ProblemaDiDisponibilita[] {
  const problemi: ProblemaDiDisponibilita[] = [];
  for (const riga of righe) {
    const mia = tengoIo.get(chiaveDellaRiga(riga.id, riga.variantId)) ?? 0;
    const disponibile = disponibileAScaffale(riga) + mia;
    if (riga.quantity > disponibile) {
      problemi.push({ id: riga.id, name: riga.name, requested: riga.quantity, available: disponibile });
    }
  }
  return problemi;
}

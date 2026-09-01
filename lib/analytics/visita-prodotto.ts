/**
 * CONTARE UNA VISITA A UNA SCHEDA PRODOTTO, NELL'ORDINE GIUSTO.
 *
 * 27/8/2026 (R175) — il freno («questa scheda l'ho già contata in questa sessione») veniva messo
 * PRIMA di scrivere la riga. Se la scrittura falliva, la visita restava segnata come contata per
 * tutta la sessione: persa, senza che nessuno potesse accorgersene. E l'evento verso i sistemi di
 * misura partiva comunque, quindi i due conti divergevano.
 *
 * Adesso l'ordine è: guarda il consenso · guarda se è già contata · scrivi · e solo se la scrittura
 * è andata bene segna il freno e annuncia. Un fallimento lascia le cose come stavano, e il
 * tentativo dopo ci riprova davvero.
 *
 * 🟢 Pura rispetto al mondo: sessione, rete e sistemi di misura arrivano da fuori, quindi una prova
 * la ESEGUE per intero, compreso il caso in cui la scrittura fallisce.
 */

export type EsitoVisita = 'senza-consenso' | 'gia-contata' | 'contata' | 'non-riuscita';

export interface DipendenzeVisita {
  /** Il consenso statistico, letto ADESSO (non quello di quando è stata aperta la pagina). */
  consenso: () => boolean;
  giaContata: (chiave: string) => boolean;
  segnaContata: (chiave: string) => void;
  /** L'evento verso i sistemi di misura (PostHog, GA4). */
  annuncia: () => void;
  /** La riga in `product_views` (più «visti di recente» per chi ha l'account). */
  registra: () => Promise<void>;
}

export const chiaveDellaVisita = (productId: string) => `mc_viewed_${productId}`;

export async function contaLaVisita(productId: string, d: DipendenzeVisita): Promise<EsitoVisita> {
  if (!d.consenso()) return 'senza-consenso';
  const chiave = chiaveDellaVisita(productId);
  if (d.giaContata(chiave)) return 'gia-contata';

  try {
    await d.registra();
  } catch {
    // Niente freno e niente annuncio: per il conteggio è come se non fosse successo, e alla
    // prossima occasione (un altro disegno, o l'arrivo del consenso) si riprova.
    return 'non-riuscita';
  }

  d.segnaContata(chiave);
  d.annuncia();
  return 'contata';
}

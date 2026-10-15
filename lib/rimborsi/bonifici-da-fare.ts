/**
 * LA LISTA DEI BONIFICI DI RIMBORSO DA FARE (R71).
 *
 * Quando un reso di un ordine in contanti si rimborsa col bonifico, i soldi non
 * escono da soli: li manda a mano chi amministra MyCity. Il rimborso e'
 * registrato (`returns.refund_id = 'bonifico:<chiave>'`), e qui si costruisce
 * la lista che quella persona guarda: quanto, per quale ordine, su quale IBAN,
 * e se l'ha gia' fatto. L'IBAN intero lo vede solo questa lista — servita dal
 * server, a chi amministra — perche' e' chi paga.
 *
 * Collaudo del 15/10 — ANCHE I RECLAMI. Un reclamo chiuso a favore del cliente
 * su un ordine in contanti si rimborsa col bonifico anche lui, ma la lista
 * leggeva solo i resi: il bonifico promesso dopo un reclamo restava scritto
 * solo nell'avviso della campanella, e l'ordine diceva gia' «rimborsato». Perso
 * l'avviso, il cliente aspettava soldi che nessuno vedeva. Ora i reclami hanno
 * la loro riga (`bonifici_dei_reclami`, migrazione 162) e stanno nella stessa
 * lista, con lo stesso pulsante «fatto».
 *
 * Funzioni pure: la rotta legge le righe, qui si decide cosa mostrare.
 */

/** Una riga di `returns` come la legge la rotta (le colonne della 162 possono mancare). */
export interface RigaDelReso {
  id: string;
  order_id: string;
  refund_amount_cents: number | null;
  refunded_at: string | null;
  refund_id: string | null;
  refund_iban?: string | null;
  refund_bonifico_cents?: number | null;
  refund_bonifico_fatto_at?: string | null;
}

/** Una riga di `bonifici_dei_reclami` (migrazione 162). */
export interface RigaDelBonificoDelReclamo {
  dispute_id: string;
  order_id: string;
  importo_cents: number | null;
  registrato_at: string | null;
  fatto_at: string | null;
}

export interface VoceDaBonificare {
  /** Da dove viene il rimborso: il segno «fatto» si scrive li'. */
  tipo: 'reso' | 'reclamo';
  /** L'id del reso o del reclamo. */
  id: string;
  ordineId: string;
  importoCents: number;
  /** Quando il rimborso e' stato registrato. */
  registratoIl: string | null;
  /**
   * L'IBAN a gruppi di quattro, oppure null se il cliente non l'ha dato. Sui
   * reclami e' sempre null: il modulo del reclamo non lo chiede, e chi paga lo
   * chiede al cliente.
   */
  iban: string | null;
  /** Quando il bonifico e' stato segnato come fatto. */
  fattoIl: string | null;
  daFare: boolean;
}

/** Il segno che `refundOrder` lascia sui rimborsi da pagare col bonifico. */
export function eUnBonificoDiRimborso(refundId: string | null | undefined): boolean {
  return typeof refundId === 'string' && refundId.startsWith('bonifico:');
}

/** L'IBAN come si legge e si ricopia: a gruppi di quattro. */
export function ibanLeggibile(iban: string | null | undefined): string | null {
  if (!iban) return null;
  return iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

/**
 * La tabella dei bonifici dei reclami non c'e' ancora (162 non applicata)?
 * PostgreSQL risponde 42P01, PostgREST PGRST205 (tabella fuori dallo schema).
 */
export function tabellaDeiBonificiMancante(errore: { code?: string; message?: string } | null | undefined): boolean {
  if (!errore) return false;
  if (errore.code === '42P01' || errore.code === 'PGRST205') return true;
  const testo = (errore.message ?? '').toLowerCase();
  return testo.includes('bonifici_dei_reclami') && (testo.includes('does not exist') || testo.includes('could not find'));
}

/** Dai resi e dai reclami alla lista: prima quelli da fare, poi i piu' recenti. */
export function vociDeiBonificiDaFare(
  righe: readonly RigaDelReso[],
  reclami: readonly RigaDelBonificoDelReclamo[] = [],
): VoceDaBonificare[] {
  const daiResi: VoceDaBonificare[] = righe
    .filter((r) => eUnBonificoDiRimborso(r.refund_id))
    .map((r) => ({
      tipo: 'reso' as const,
      id: r.id,
      ordineId: r.order_id,
      // Quanto va col bonifico: su un ordine pagato in parte col credito, la
      // parte del credito e' gia' tornata da sola. Senza la 162 la colonna non
      // c'e' e si mostra l'intero rimborso (l'avviso del bonifico ha la cifra giusta).
      importoCents: Math.max(0, Math.round(Number(r.refund_bonifico_cents ?? r.refund_amount_cents ?? 0))),
      registratoIl: r.refunded_at ?? null,
      iban: ibanLeggibile(r.refund_iban),
      fattoIl: r.refund_bonifico_fatto_at ?? null,
      daFare: !r.refund_bonifico_fatto_at,
    }));
  const daiReclami: VoceDaBonificare[] = reclami
    .filter((r) => Number(r.importo_cents ?? 0) > 0)
    .map((r) => ({
      tipo: 'reclamo' as const,
      id: r.dispute_id,
      ordineId: r.order_id,
      importoCents: Math.round(Number(r.importo_cents)),
      registratoIl: r.registrato_at ?? null,
      iban: null,
      fattoIl: r.fatto_at ?? null,
      daFare: !r.fatto_at,
    }));
  return [...daiResi, ...daiReclami].sort((a, b) => {
    if (a.daFare !== b.daFare) return a.daFare ? -1 : 1;
    return String(b.registratoIl ?? '').localeCompare(String(a.registratoIl ?? ''));
  });
}

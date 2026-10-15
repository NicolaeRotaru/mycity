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

export interface VoceDaBonificare {
  resoId: string;
  ordineId: string;
  importoCents: number;
  /** Quando il rimborso e' stato registrato. */
  registratoIl: string | null;
  /** L'IBAN a gruppi di quattro, oppure null se il cliente non l'ha dato. */
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

/** Dalle righe dei resi alla lista: prima quelli da fare, poi i piu' recenti. */
export function vociDeiBonificiDaFare(righe: readonly RigaDelReso[]): VoceDaBonificare[] {
  return righe
    .filter((r) => eUnBonificoDiRimborso(r.refund_id))
    .map((r) => ({
      resoId: r.id,
      ordineId: r.order_id,
      // Quanto va col bonifico: su un ordine pagato in parte col credito, la
      // parte del credito e' gia' tornata da sola. Senza la 162 la colonna non
      // c'e' e si mostra l'intero rimborso (l'avviso del bonifico ha la cifra giusta).
      importoCents: Math.max(0, Math.round(Number(r.refund_bonifico_cents ?? r.refund_amount_cents ?? 0))),
      registratoIl: r.refunded_at ?? null,
      iban: ibanLeggibile(r.refund_iban),
      fattoIl: r.refund_bonifico_fatto_at ?? null,
      daFare: !r.refund_bonifico_fatto_at,
    }))
    .sort((a, b) => {
      if (a.daFare !== b.daFare) return a.daFare ? -1 : 1;
      return String(b.registratoIl ?? '').localeCompare(String(a.registratoIl ?? ''));
    });
}

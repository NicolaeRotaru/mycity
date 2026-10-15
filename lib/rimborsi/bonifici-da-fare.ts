/**
 * LA LISTA DEI BONIFICI DI RIMBORSO DA FARE (R71).
 *
 * Quando un reso di un ordine in contanti si rimborsa col bonifico, i soldi non
 * escono da soli: li manda a mano chi amministra MyCity. Il rimborso e'
 * registrato (`returns.refund_id = 'bonifico:<centesimi>:<chiave>'`), e qui si costruisce
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
 * Collaudo del 15/10, secondo giro — LA CIFRA DEL BONIFICO NON SI INDOVINA.
 * Senza la migrazione 162 la colonna con la cifra del bonifico non c'e', e la
 * lista ripiegava sull'intero rimborso. Su un ordine da 50 € pagato 20 di
 * credito e 30 in contanti, il credito tornava da solo e la lista diceva
 * «50,00 €» da bonificare: chi la seguiva pagava 50 invece di 30, e il cliente
 * riceveva 70 € su 50 spesi. Adesso la cifra la scrive `refundOrder` nel segno
 * stesso del rimborso (`bonifico:<centesimi>:<chiave>`), che sta in una colonna
 * che c'e' da sempre. Se nemmeno il segno la porta, la lista NON mette una
 * cifra: dice di prenderla dall'avviso del bonifico.
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
  /**
   * Quanto va col bonifico. `null` vuol dire «non lo so con certezza»: la
   * pagina non mostra una cifra, e manda a leggerla nell'avviso del bonifico.
   * Mai l'intero rimborso al posto della sola parte del bonifico.
   */
  importoCents: number | null;
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

/**
 * Il segno di un rimborso da pagare col bonifico, con dentro QUANTO: la cifra
 * resta scritta dove la lista la ritrova anche senza la migrazione 162.
 */
export function segnoDelBonifico(chiave: string, bonificoCents: number): string {
  return `bonifico:${Math.max(0, Math.round(bonificoCents))}:${chiave}`;
}

/** La cifra del bonifico scritta nel segno, oppure `null` se il segno non la porta. */
export function centesimiDelBonificoDalSegno(refundId: string | null | undefined): number | null {
  if (typeof refundId !== 'string') return null;
  const trovato = /^bonifico:(\d+):/.exec(refundId);
  return trovato ? Number(trovato[1]) : null;
}

/**
 * Quanto va col bonifico per un reso: la colonna della 162, poi il segno del
 * rimborso. MAI `refund_amount_cents`: e' l'intero rimborso, e su un ordine
 * pagato in parte col credito comprende la parte gia' tornata come credito.
 */
export function cifraDelBonificoDelReso(r: Pick<RigaDelReso, 'refund_bonifico_cents' | 'refund_id'>): number | null {
  if (r.refund_bonifico_cents != null) return Math.max(0, Math.round(Number(r.refund_bonifico_cents)));
  return centesimiDelBonificoDalSegno(r.refund_id);
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
      // parte del credito e' gia' tornata da sola (vedi in testa al file).
      importoCents: cifraDelBonificoDelReso(r),
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

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
 * Riesame del 16/10 — UN BONIFICO VECCHIO NON ESCE DALLA FINESTRA. La lista
 * leggeva gli ultimi 200 rimborsi col bonifico, fatti compresi, e solo dopo il
 * taglio metteva in cima quelli da fare: con 200 bonifici gia' pagati dopo di
 * lui, il bonifico da 18 € del 1° marzo non lo vedeva piu' nessuno. Adesso le
 * letture sono due: i bonifici da fare (tutti, fino a un tetto alto, e se il
 * tetto si tocca la pagina lo dice) e solo gli ultimi fatti, come storico.
 *
 * Funzioni pure: la rotta legge le righe, qui si decide cosa mostrare.
 */

import { formatPriceFromCents } from '@/lib/format';

/** Quanti bonifici da fare si leggono al massimo: oltre, la pagina dice che la lista e' tagliata. */
export const TETTO_DEI_BONIFICI_DA_FARE = 1000;

/** Quanti bonifici gia' fatti si mostrano, come storico. */
export const TETTO_DEI_BONIFICI_FATTI = 50;

/** La lettura dei bonifici da fare ha toccato il tetto: forse ce n'e' qualcuno in piu'. */
export function letturaDeiDaFareTagliata(righeLette: number, tetto: number = TETTO_DEI_BONIFICI_DA_FARE): boolean {
  return righeLette >= tetto;
}

/** Una riga di `returns` come la legge la rotta (le colonne della 162 possono mancare). */
export interface RigaDelReso {
  id: string;
  order_id: string;
  refund_amount_cents: number | null;
  refunded_at: string | null;
  refund_id: string | null;
  refund_iban?: string | null;
  /** Il nome a cui intestare il bonifico: c'e' solo se il cliente ha cancellato l'account prima del pagamento. */
  refund_intestatario?: string | null;
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
  /** L'IBAN che il cliente ha mandato dai Contatti, copiato qui da chi paga (riesame del 16/10). */
  iban?: string | null;
  /** Il nome a cui intestare il bonifico, se il cliente ha cancellato l'account prima del pagamento. */
  intestatario?: string | null;
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
   * L'IBAN a gruppi di quattro, oppure null se non c'e' ancora. Sui reclami il
   * modulo non lo chiede: lo chiediamo per email, il cliente lo manda dai
   * Contatti e chi paga lo copia qui (riesame del 16/10).
   */
  iban: string | null;
  /**
   * A chi intestare il bonifico, quando il cliente ha cancellato l'account
   * prima del pagamento: la riga ordine non porta piu' il nome, e questo e'
   * l'unico posto dove resta. Null finche' l'account c'e'.
   */
  intestatario: string | null;
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
      intestatario: r.refund_intestatario ?? null,
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
      iban: ibanLeggibile(r.iban),
      intestatario: r.intestatario ?? null,
      fattoIl: r.fatto_at ?? null,
      daFare: !r.fatto_at,
    }));
  // Le due letture (da fare e fatti) non si sovrappongono; se una riga arriva due volte, conta una.
  const viste = new Set<string>();
  const uniche = [...daiResi, ...daiReclami].filter((v) => {
    const chiave = `${v.tipo}:${v.id}`;
    if (viste.has(chiave)) return false;
    viste.add(chiave);
    return true;
  });
  return uniche.sort((a, b) => {
    if (a.daFare !== b.daFare) return a.daFare ? -1 : 1;
    return String(b.registratoIl ?? '').localeCompare(String(a.registratoIl ?? ''));
  });
}

/** Le ultime quattro cifre di un IBAN, per riconoscerlo a colpo d'occhio. */
function finale(iban: string | null): string | null {
  const pulito = (iban ?? '').replace(/\s+/g, '');
  return pulito.length >= 4 ? pulito.slice(-4) : null;
}

/**
 * LA DOMANDA PRIMA DI «BONIFICO FATTO» (riesame del 16/10).
 *
 * Il pulsante partiva al primo tocco: un dito sbagliato dal telefono toglieva
 * un cliente dai bonifici da fare senza che avesse ricevuto un euro, e non si
 * tornava indietro. Adesso si chiede, con la cifra e il conto davanti: chi ha
 * appena fatto il bonifico li riconosce, chi ha sbagliato riga se ne accorge.
 */
export function domandaPrimaDelBonificoFatto(
  voce: Pick<VoceDaBonificare, 'tipo' | 'ordineId' | 'importoCents' | 'iban' | 'intestatario'>,
): { title: string; message: string; confirmLabel: string; cancelLabel: string } {
  const cifra = voce.importoCents != null ? formatPriceFromCents(voce.importoCents) : null;
  const conto = finale(voce.iban);
  const verso = [
    conto ? `sul conto che finisce con ${conto}` : null,
    voce.intestatario ? `intestato a ${voce.intestatario}` : null,
  ].filter(Boolean).join(', ');
  const pratica = `${voce.tipo === 'reclamo' ? 'il reclamo' : 'il reso'} dell'ordine #${voce.ordineId.slice(0, 8)}`;
  return {
    title: cifra ? `Hai fatto il bonifico di ${cifra}?` : 'Hai fatto il bonifico?',
    message:
      `Per ${pratica}${verso ? `, ${verso}` : ''}. ` +
      "Se confermi, il rimborso esce dai bonifici da fare e l'IBAN si cancella: non si torna indietro.",
    confirmLabel: "Sì, l'ho fatto",
    cancelLabel: 'Non ancora',
  };
}

/**
 * IL RIMBORSO E' PARTITO MA IL RESO NON LO SA (riesame del 16/10).
 *
 * In `avanza` i soldi escono prima, poi si scrive sul reso il segno del
 * rimborso: e' quel segno che fa comparire un bonifico nella lista di chi
 * paga. Se la scrittura cadeva, la rotta rispondeva «ok» lo stesso: il reso
 * restava «rimborsato» senza segno, la lista non lo mostrava e il negozio
 * leggeva «fatto». Adesso chi amministra riceve questo avviso, con tutto quello
 * che serve per ritrovare il rimborso, e il negozio legge che non e' andata.
 */
export function avvisoDelRimborsoNonRegistrato(r: {
  resoId: string;
  ordineId: string;
  refundId: string | null;
  bonificoCents: number;
}): { titolo: string; testo: string; link: string } {
  const ordine = `#${r.ordineId.slice(0, 8)}`;
  const bonifico = r.bonificoCents > 0;
  return {
    titolo: '⚠️ Rimborso partito ma non registrato sul reso',
    testo:
      `Il rimborso del reso ${r.resoId} (ordine ${ordine}) è partito, ma il database non ha registrato l'esito sul reso` +
      (r.refundId ? ` (riferimento ${r.refundId})` : '') +
      '. ' +
      (bonifico
        ? `Dentro c'è un bonifico di ${formatPriceFromCents(r.bonificoCents)} da fare al cliente: NON compare nella lista dei bonifici da fare finché il reso non è registrato. Fallo da qui e scrivi sul reso il riferimento.`
        : 'Scrivi sul reso il riferimento del rimborso, così i conti tornano.'),
    link: bonifico ? '/admin/rimborsi-da-bonificare' : '/admin/orders',
  };
}

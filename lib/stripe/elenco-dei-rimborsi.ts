/**
 * L'elenco dei rimborsi Stripe già scritti su un ordine: la colonna
 * `stripe_refund_id`, con gli id separati da virgola.
 *
 * Sta in un file suo, senza dipendenze, perché lo usano in due: il webhook dei
 * rimborsi dal cruscotto (`webhook/rimborsi-da-fuori.ts`) e `refundOrder`
 * (`payout.ts`). Il primo importa già dal secondo: se il secondo importasse dal
 * primo, i due file si chiamerebbero a vicenda.
 *
 * 16/10/2026 (riesame del lotto) — `refundOrder` SOSTITUIVA L'ELENCO.
 *
 * Il webhook usa questo elenco come rete per quando Stripe non mette
 * l'etichetta «registrato» su un rimborso dal cruscotto: un id in elenco non si
 * registra più. Ma `refundOrder` scriveva sulla colonna il SUO rimborso e
 * basta, e l'elenco di prima spariva. Un caso: 3 € dal cruscotto registrati,
 * etichetta mancata; poi un reso da 5 € dal sito; poi un secondo reso da 5 € la
 * cui risposta di Stripe si perde. All'avviso mancavano 5 € sul database, i 3 €
 * non erano più in elenco e si registravano di nuovo: 11 € segnati su 8 usciti,
 * e al negozio la quota dei 3 € tolta due volte. Adesso chi scrive un rimborso
 * lo AGGIUNGE all'elenco.
 */

/** Quanti rimborsi tiene a mente l'ordine: bastano e avanzano, e la riga non cresce per sempre. */
export const RIMBORSI_A_MENTE = 15;

/** Gli id dei rimborsi che l'ordine dice di aver già scritto. */
export function rimborsiGiaScritti(ordine: { stripe_refund_id?: string | null }): Set<string> {
  return new Set((ordine.stripe_refund_id ?? '').split(',').map((x) => x.trim()).filter(Boolean));
}

/**
 * Il valore da scrivere sulla colonna: quelli di prima più i nuovi, senza
 * doppioni, gli ultimi RIMBORSI_A_MENTE. Mai meno di quelli che c'erano (finché
 * stanno sotto il tetto): chi aggiunge un rimborso non cancella quelli degli altri.
 */
export function elencoDaScrivere(prima: ReadonlySet<string>, nuovi: ReadonlyArray<string>): string {
  const tutti = [...prima];
  for (const id of nuovi) {
    const pulito = id.trim();
    if (pulito && !tutti.includes(pulito)) tutti.push(pulito);
  }
  return tutti.slice(-RIMBORSI_A_MENTE).join(',');
}

/**
 * IL SEGNO DI UN RIMBORSO DA PAGARE COL BONIFICO (R71).
 *
 * Chi ha pagato in contanti riavrà i soldi con un bonifico, che fa a mano chi
 * amministra MyCity. `refundOrder` lo registra nell'elenco qui sopra, con la
 * cifra dentro: `bonifico:3000:return_<id del reso>`. Quella colonna la scrive
 * solo il server (migrazione 061), e la pagina dell'ordine la legge già.
 * Stanno qui, senza dipendenze, perché le usano il server e la pagina.
 */
export function segnoDelBonifico(chiave: string, bonificoCents: number): string {
  return `bonifico:${Math.max(0, Math.round(bonificoCents))}:${chiave}`;
}

/** Vero se un id dell'elenco è il segno di un bonifico da fare. */
export function eUnBonificoDiRimborso(refundId: string | null | undefined): boolean {
  return typeof refundId === 'string' && refundId.startsWith('bonifico:');
}

/** La cifra del bonifico scritta nel segno, oppure `null` se il segno non la porta. */
export function centesimiDelBonificoDalSegno(refundId: string | null | undefined): number | null {
  if (typeof refundId !== 'string') return null;
  const trovato = /^bonifico:(\d+):/.exec(refundId);
  return trovato ? Number(trovato[1]) : null;
}

/**
 * Il bonifico di questa chiave (`return_<id>`, `dispute_<id>`) gia' scritto sull'ordine, se c'e'.
 * La chiave si confronta intera: `return_r1` non e' `return_r10`.
 */
export function bonificoDellaChiave(
  ordine: { stripe_refund_id?: string | null } | null | undefined,
  chiave: string,
): { segno: string; centesimi: number } | null {
  for (const segno of rimborsiGiaScritti(ordine ?? {})) {
    const trovato = /^bonifico:(\d+):(.+)$/.exec(segno);
    if (trovato && trovato[2] === chiave) return { segno, centesimi: Number(trovato[1]) };
  }
  return null;
}

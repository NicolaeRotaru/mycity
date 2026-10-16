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
 * Riesame del 16/10, terzo giro — LA LISTA NON SI FIDA DI UNA RIGA CHE IL
 * CLIENTE PUO' SCRIVERE. In produzione la migrazione 153 non c'e': vale ancora
 * la regola della 024, e un cliente puo' inserire da solo una riga di reso
 * intera — stato «rimborsato», segno `bonifico:95000:…` e il suo IBAN. La lista
 * la mostrava a chi paga come «950,00 € da bonificare». Adesso un bonifico di
 * un reso e' confermato solo se il suo segno sta anche nell'elenco dei rimborsi
 * dell'ORDINE, che scrive soltanto il server (`refundOrder`): sull'ordine il
 * cliente e il negozio non scrivono quella colonna, con o senza la 153. Un
 * bonifico da fare non confermato esce dai bonifici da pagare e va in un
 * elenco a parte, «da controllare prima di pagare» (`smistaLeVoci`).
 *
 * Funzioni pure: la rotta legge le righe, qui si decide cosa mostrare.
 */

import { formatPriceFromCents } from '@/lib/format';
import { rimborsiGiaScritti } from '@/lib/stripe/elenco-dei-rimborsi';

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
  /**
   * Il segno del bonifico c'e' solo sull'ordine: la scrittura dell'esito sul reso era caduta
   * (vedi `bonificiRimastiSoloSullOrdine`). La riga e' ricostruita dall'ordine.
   */
  soloSullOrdine?: boolean;
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
  /**
   * Il bonifico l'ha registrato il server? Per un reso: il suo segno sta
   * nell'elenco dei rimborsi dell'ordine (vedi `bonificoRegistratoSullOrdine`).
   * Per un reclamo sempre: la sua riga la scrive solo il server (162).
   */
  confermataDallOrdine: boolean;
  /**
   * Il rimborso e' partito ma il reso non lo porta ancora scritto (riesame del 16/10, quarto
   * giro): la voce viene dall'ordine. Segnando il bonifico — o scrivendo l'IBAN — il rimborso si
   * registra anche sul reso.
   */
  daRegistrareSulReso?: boolean;
}

/** Quello che serve dell'ordine per riconoscere un bonifico registrato dal server. */
export interface OrdineDelBonifico {
  id: string;
  /** L'elenco dei rimborsi registrati sull'ordine (`lib/stripe/elenco-dei-rimborsi.ts`). */
  stripe_refund_id?: string | null;
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

/**
 * IL BONIFICO DI QUESTO RESO L'HA REGISTRATO IL SERVER? (riesame del 16/10, terzo giro)
 *
 * `refundOrder` scrive il segno del bonifico in due posti: sul reso (e' quello
 * che la lista cerca) e nell'elenco dei rimborsi dell'ordine. Il reso, senza la
 * 153, lo puo' scrivere anche il cliente; l'elenco dell'ordine no. Il segno
 * porta la chiave del rimborso, che per un reso e' `return_<id del reso>`:
 * cosi' una riga finta che copia il segno di un rimborso vero non passa,
 * perche' il suo id e' un altro.
 */
export function bonificoRegistratoSullOrdine(
  r: Pick<RigaDelReso, 'id' | 'refund_id'>,
  ordine: OrdineDelBonifico | null | undefined,
): boolean {
  if (!ordine || !eUnBonificoDiRimborso(r.refund_id)) return false;
  const segno = String(r.refund_id);
  if (!segno.endsWith(`:return_${r.id}`)) return false;
  return rimborsiGiaScritti(ordine).has(segno);
}

/**
 * IL RIMBORSO DI QUESTO RESO E' GIA' SULL'ORDINE? (riesame del 16/10, terzo giro)
 *
 * Se la scrittura dell'esito sul reso cade dopo che il rimborso e' partito, il
 * reso resta senza segno ma l'ordine no: nel suo elenco dei rimborsi c'e' gia'
 * `bonifico:<centesimi>:return_<id del reso>`. Da qui `avanza` riconosce il
 * caso: «rimborsato» registra il rimborso che c'e' invece di rifarlo, e «chiudi
 * senza rimborso» non passa — cancellerebbe l'IBAN di chi aspetta il bonifico.
 */
export function bonificoDelResoGiaSullOrdine(
  resoId: string,
  ordine: Pick<OrdineDelBonifico, 'stripe_refund_id'> | null | undefined,
): { segno: string; centesimi: number } | null {
  if (!ordine) return null;
  for (const segno of rimborsiGiaScritti(ordine)) {
    if (!eUnBonificoDiRimborso(segno) || !segno.endsWith(`:return_${resoId}`)) continue;
    const centesimi = centesimiDelBonificoDalSegno(segno);
    if (centesimi != null) return { segno, centesimi };
  }
  return null;
}

/**
 * Gli stati di un reso su cui il rimborso puo' essere gia' partito: approvato (in `decide` il
 * rimborso esce subito), in viaggio, ricevuto, rimborsato (in `avanza` lo stato si scrive prima).
 */
export const STATI_DEL_RESO_COL_RIMBORSO_FORSE_PARTITO = ['APPROVED', 'SHIPPED_BACK', 'RECEIVED', 'REFUNDED'] as const;

/** Un reso senza il segno del rimborso, come lo legge la lista dei bonifici. */
export interface ResoSenzaSegno extends Omit<RigaDelReso, 'soloSullOrdine'> {
  status: string | null;
}

/**
 * LA SCRITTURA CHE ERA CADUTA (riesame del 16/10, quarto giro).
 *
 * In `decide` e in `avanza` il rimborso si registra sull'ordine dentro `refundOrder` — nello
 * stesso aggiornamento che scrive «rimborsato» — e solo dopo, con una scrittura a parte, sul reso.
 * Se quella cade, l'ordine porta `bonifico:<centesimi>:return_<id del reso>` e il reso niente.
 * Qui c'e' la scrittura mancante, la stessa che la rotta avrebbe fatto: reso rimborsato, col segno
 * e la cifra del bonifico. `null` se il reso il segno ce l'ha, o se l'ordine non porta nessun
 * bonifico di questo reso (allora non c'e' niente da registrare: il rimborso non e' partito).
 */
export function registrazioneMancanteDelBonifico(
  reso: { id: string; status: string | null; refund_id: string | null },
  ordine: Pick<OrdineDelBonifico, 'stripe_refund_id'> | null | undefined,
): { status: 'REFUNDED'; refund_id: string; refund_bonifico_cents: number } | null {
  if (reso.refund_id) return null;
  if (!(STATI_DEL_RESO_COL_RIMBORSO_FORSE_PARTITO as readonly string[]).includes(String(reso.status))) return null;
  const sullOrdine = bonificoDelResoGiaSullOrdine(reso.id, ordine);
  if (!sullOrdine) return null;
  return { status: 'REFUNDED', refund_id: sullOrdine.segno, refund_bonifico_cents: sullOrdine.centesimi };
}

/**
 * I BONIFICI CHE STANNO SOLO SULL'ORDINE (riesame del 16/10, quarto giro).
 *
 * La lista dei bonifici cercava il segno sul reso, e basta: se la scrittura sul reso era caduta,
 * il bonifico non c'era. L'ordine diceva «rimborsato», al negozio la quota era gia' stata ripresa,
 * e a chi paga restava solo un avviso nella campanella — che per giunta mandava a questa lista.
 * Adesso la lista legge anche i resi senza segno e li confronta con l'elenco dei rimborsi
 * dell'ordine (lo scrive solo il server, nello stesso passo dei conti): dove l'ordine porta il
 * bonifico di quel reso, la voce c'e', con la cifra dell'ordine e l'IBAN del reso.
 */
export function bonificiRimastiSoloSullOrdine(
  resi: readonly ResoSenzaSegno[],
  ordini: readonly OrdineDelBonifico[],
): RigaDelReso[] {
  const ordinePer = new Map(ordini.map((o) => [o.id, o]));
  const righe: RigaDelReso[] = [];
  for (const r of resi) {
    const mancante = registrazioneMancanteDelBonifico(r, ordinePer.get(r.order_id));
    if (!mancante) continue;
    righe.push({
      id: r.id,
      order_id: r.order_id,
      refund_amount_cents: r.refund_amount_cents,
      refunded_at: r.refunded_at,
      refund_iban: r.refund_iban,
      refund_intestatario: r.refund_intestatario,
      refund_bonifico_fatto_at: r.refund_bonifico_fatto_at,
      refund_id: mancante.refund_id,
      refund_bonifico_cents: mancante.refund_bonifico_cents,
      soloSullOrdine: true,
    });
  }
  return righe;
}

/** Dai resi e dai reclami alla lista: prima quelli da fare, poi i piu' recenti. */
export function vociDeiBonificiDaFare(
  righe: readonly RigaDelReso[],
  reclami: readonly RigaDelBonificoDelReclamo[] = [],
  ordini: readonly OrdineDelBonifico[] = [],
): VoceDaBonificare[] {
  const ordinePer = new Map(ordini.map((o) => [o.id, o]));
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
      confermataDallOrdine: bonificoRegistratoSullOrdine(r, ordinePer.get(r.order_id)),
      ...(r.soloSullOrdine ? { daRegistrareSulReso: true } : {}),
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
      // La riga di un reclamo la scrive e la legge solo il server (162).
      confermataDallOrdine: true,
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

/**
 * COSA DICE LA PAGINA ACCANTO A UNA VOCE (riesame del 16/10, terzo giro).
 *
 *  · Un bonifico da fare non confermato dall'ordine porta l'avviso di non
 *    pagarlo prima di aver controllato: la riga puo' averla scritta il cliente.
 *  · Al posto dell'IBAN che manca: su un bonifico gia' fatto l'IBAN e' stato
 *    cancellato apposta (prima diceva «quando arriva, scrivilo qui» anche li',
 *    dove un campo non c'e'); senza la migrazione 162 non si puo' salvare, e
 *    si tiene a parte. «Scrivilo qui» solo dove il campo c'e'.
 */
export function cosaDiceLaVoce(
  voce: Pick<VoceDaBonificare, 'daFare' | 'iban' | 'confermataDallOrdine' | 'daRegistrareSulReso'>,
  migrazione162: boolean,
): {
  daControllare: string | null;
  alPostoDellIban: string | null;
  campoPerLIban: boolean;
  /** Riesame del 16/10, quarto giro: il rimborso non e' ancora scritto sul reso. */
  sulReso: string | null;
} {
  const campoPerLIban = voce.daFare && !voce.iban && migrazione162;
  let alPostoDellIban: string | null = null;
  if (!voce.iban) {
    if (!voce.daFare) alPostoDellIban = 'IBAN cancellato dopo il bonifico.';
    else if (campoPerLIban) {
      alPostoDellIban =
        "IBAN non indicato: l'email di rimborso chiede al cliente di mandarlo dalla pagina Contatti. Quando arriva, scrivilo qui.";
    } else {
      alPostoDellIban =
        "IBAN non indicato: l'email di rimborso chiede al cliente di mandarlo dalla pagina Contatti. Finché sul database manca la migrazione 162 non si può salvare qui: tienilo a parte.";
    }
  }
  return {
    daControllare:
      voce.daFare && !voce.confermataDallOrdine
        ? "Da controllare prima di pagare: questo rimborso non risulta registrato sull'ordine, e una riga così può averla scritta qualcun altro. Apri l'ordine e cerca l'avviso «Bonifico di rimborso da fare»: se non c'è, non pagare."
        : null,
    alPostoDellIban,
    campoPerLIban,
    sulReso:
      voce.daFare && voce.daRegistrareSulReso
        ? "Il rimborso è partito ma sul reso non si era registrato: la cifra viene dall'ordine. Quando segni il bonifico fatto, lo registriamo anche sul reso."
        : null,
  };
}

/**
 * I BONIFICI DA PAGARE E QUELLI DA CONTROLLARE (riesame del 16/10, terzo giro).
 *
 * Fra i bonifici da pagare restano solo quelli che il server ha registrato, e
 * lo storico dei fatti. Un bonifico da fare che l'ordine non conferma va a
 * parte: puo' essere una riga scritta dal cliente, oppure un rimborso vero la
 * cui conferma sull'ordine non si e' scritta — per questo non sparisce, ma
 * chi paga lo trova sotto l'avviso di controllarlo prima.
 */
export function smistaLeVoci(voci: readonly VoceDaBonificare[]): {
  daPagare: VoceDaBonificare[];
  daControllare: VoceDaBonificare[];
} {
  const daControllare = voci.filter((v) => v.daFare && !v.confermataDallOrdine);
  return { daPagare: voci.filter((v) => !daControllare.includes(v)), daControllare };
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

/** Cosa legge chi ha premuto, quando il rimborso e' partito ma il reso non lo sa. */
export const RIMBORSO_PARTITO_MA_NON_REGISTRATO =
  "Il rimborso è partito ma non si è potuto registrare sul reso: abbiamo avvisato l'amministrazione. Non ripetere il rimborso.";

/**
 * IL RIMBORSO E' PARTITO MA IL RESO NON LO SA (riesame del 16/10).
 *
 * In `avanza` e in `decide` i soldi escono prima, poi si scrive sul reso il segno del
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
      // Riesame del 16/10, quarto giro — la lista legge il bonifico anche dall'ordine, che lo porta
      // gia' scritto: la voce c'e', e «Bonifico fatto» registra il rimborso anche sul reso. Prima
      // questo avviso mandava alla lista dicendo che li' il bonifico non c'era.
      (bonifico
        ? `Dentro c'è un bonifico di ${formatPriceFromCents(r.bonificoCents)} da fare al cliente: lo trovi nella lista dei bonifici da fare, presa dall'ordine. Quando lo segni fatto, il rimborso si registra anche sul reso.`
        : 'Scrivi sul reso il riferimento del rimborso, così i conti tornano.'),
    link: bonifico ? '/admin/rimborsi-da-bonificare' : '/admin/orders',
  };
}

/**
 * IL BONIFICO DEL RECLAMO NON E' ENTRATO NELLA LISTA (riesame del 16/10, terzo giro).
 *
 * Chiuso un reclamo a favore del cliente su un ordine in contanti, il bonifico
 * si scrive in `bonifici_dei_reclami`, ed e' li' che la lista lo trova. Se
 * quella scrittura cadeva per un guasto (non per la tabella che manca), la
 * rotta lo scriveva solo nel registro degli errori: l'ordine diceva gia'
 * «rimborsato» e la lista sembrava completa. Adesso chi amministra riceve
 * questo avviso, con la cifra e l'ordine.
 */
export function avvisoDelBonificoDelReclamoNonRegistrato(r: {
  reclamoId: string;
  ordineId: string;
  importoCents: number;
}): { titolo: string; testo: string; link: string } {
  return {
    titolo: '⚠️ Bonifico di un reclamo fuori dalla lista',
    testo:
      `Il bonifico di ${formatPriceFromCents(r.importoCents)} del reclamo ${r.reclamoId} (ordine #${r.ordineId.slice(0, 8)}) ` +
      "è registrato sull'ordine, ma non è entrato nella lista dei bonifici da fare: il database non ha risposto. " +
      'Fallo partendo da questo avviso e tieni il conto a parte.',
    link: '/admin/disputes',
  };
}

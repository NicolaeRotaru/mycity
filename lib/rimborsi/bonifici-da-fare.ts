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
 * elenco a parte, «da controllare prima di pagare» (tolto al sesto giro, qui sotto).
 *
 * Riesame del 16/10, sesto giro — LA LISTA LEGGE UNA FONTE SOLA: IL SEGNO SULL'ORDINE.
 * L'elenco «da controllare» chiedeva un controllo che chi paga non poteva fare
 * (cercare un avviso fra le ultime 50 notifiche, che a volte non viene scritto),
 * una riga finta non si poteva togliere se non segnandola «fatta», e mille righe
 * finte riempivano il tetto della lettura prima del bonifico vero. Adesso le voci
 * dei resi nascono SOLO dai segni `bonifico:<centesimi>:return_<id>` nell'elenco
 * dei rimborsi degli ordini, che scrive solo il server: la riga del reso serve
 * per l'IBAN, il nome e il «fatto». Una riga scritta dal cliente non entra, e
 * non consuma nessun tetto. Se il server non riesce a scrivere il segno
 * sull'ordine, chi amministra riceve un avviso apposta
 * (`avvisoDelBonificoFuoriDallaLista`).
 *
 * Funzioni pure: la rotta legge le righe, qui si decide cosa mostrare.
 */

import { formatPriceFromCents } from '@/lib/format';
import { rimborsiGiaScritti } from '@/lib/stripe/elenco-dei-rimborsi';

/**
 * Quanti bonifici da fare dei reclami si leggono al massimo: oltre, la pagina dice che la lista e'
 * tagliata. I resi non hanno tetto: si leggono tutti, dai segni sugli ordini.
 */
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
   * l'unico posto dove resta. Lo scrive la cancellazione, solo quando va avanti
   * (riesame del 16/10, quinto giro: se aspetta l'IBAN non scrive niente).
   */
  intestatario: string | null;
  /** Quando il bonifico e' stato segnato come fatto. */
  fattoIl: string | null;
  daFare: boolean;
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
 * IL RESO DI UN SEGNO (riesame del 16/10, sesto giro). Il segno di un bonifico di un reso finisce
 * con la chiave del rimborso, `return_<id del reso>`: `bonifico:4000:return_<id>` → `<id>`. `null`
 * per ogni altro segno (un rimborso con la carta, il bonifico di un reclamo, `dispute_<id>`).
 */
export function resoDelSegno(segno: string | null | undefined): string | null {
  if (!eUnBonificoDiRimborso(segno)) return null;
  const trovato = /^bonifico:(?:\d+:)?return_([^:,\s]+)$/.exec(String(segno));
  return trovato ? trovato[1] : null;
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

/** La riga di un reso come la legge la lista, per l'IBAN, il nome e il «fatto» (le colonne della 162 possono mancare). */
export interface RigaDelResoLetta {
  id: string;
  order_id?: string | null;
  refund_id?: string | null;
  refund_amount_cents?: number | null;
  refunded_at?: string | null;
  refund_iban?: string | null;
  refund_intestatario?: string | null;
  refund_bonifico_cents?: number | null;
  refund_bonifico_fatto_at?: string | null;
}

/**
 * I BONIFICI DEI RESI, DAI SEGNI SUGLI ORDINI (riesame del 16/10, sesto giro).
 *
 * Un bonifico di un reso c'e' se, e solo se, l'elenco dei rimborsi di un ordine porta il suo segno
 * `bonifico:<centesimi>:return_<id del reso>`: quell'elenco lo scrive solo il server, nello stesso
 * passo dei conti (`refundOrder`), e ne' il cliente ne' il negozio lo possono scrivere, con o senza
 * la 153 (tests/sql/rls/43). La cifra viene dal segno. La riga del reso, se c'e', da' solo l'IBAN,
 * il nome dell'intestatario, la data e il «fatto»: una riga di reso che nessun segno nomina non
 * entra, chiunque l'abbia scritta.
 *
 * I bonifici da fare ci sono tutti, senza tetto: li conta solo il server. Di quelli fatti restano
 * gli ultimi `tettoFatti`, come storico.
 */
export function bonificiDeiResiDagliOrdini(
  ordini: readonly OrdineDelBonifico[],
  resiLetti: readonly RigaDelResoLetta[],
  tettoFatti: number = TETTO_DEI_BONIFICI_FATTI,
): RigaDelReso[] {
  const resoPer = new Map(resiLetti.map((r) => [r.id, r]));
  const viste = new Set<string>();
  const righe: RigaDelReso[] = [];
  for (const ordine of ordini) {
    for (const segno of rimborsiGiaScritti(ordine)) {
      const resoId = resoDelSegno(segno);
      if (!resoId || viste.has(resoId)) continue;
      viste.add(resoId);
      const r = resoPer.get(resoId);
      const centesimi = centesimiDelBonificoDalSegno(segno);
      righe.push({
        id: resoId,
        order_id: ordine.id,
        refund_amount_cents: r?.refund_amount_cents ?? null,
        refunded_at: r?.refunded_at ?? null,
        refund_id: segno,
        refund_iban: r?.refund_iban ?? null,
        refund_intestatario: r?.refund_intestatario ?? null,
        // La cifra del segno, scritto dal server; se il segno non la porta, quella della 162.
        refund_bonifico_cents: centesimi ?? r?.refund_bonifico_cents ?? null,
        refund_bonifico_fatto_at: r?.refund_bonifico_fatto_at ?? null,
        // Il reso non porta ancora il segno: «fatto» lo registra anche li' (`registrazioneMancanteDelBonifico`).
        ...(r?.refund_id === segno ? {} : { soloSullOrdine: true }),
      });
    }
  }
  const daFare = righe.filter((r) => !r.refund_bonifico_fatto_at);
  const fatti = righe
    .filter((r) => !!r.refund_bonifico_fatto_at)
    .sort((a, b) => String(b.refund_bonifico_fatto_at).localeCompare(String(a.refund_bonifico_fatto_at)))
    .slice(0, Math.max(0, tettoFatti));
  return [...daFare, ...fatti];
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
 *  · Al posto dell'IBAN che manca: su un bonifico gia' fatto l'IBAN e' stato
 *    cancellato apposta (prima diceva «quando arriva, scrivilo qui» anche li',
 *    dove un campo non c'e'); senza la migrazione 162 non si puo' salvare, e
 *    si tiene a parte. «Scrivilo qui» solo dove il campo c'e'.
 *  · Sesto giro: l'avviso «da controllare prima di pagare» non c'e' piu'. Nella
 *    lista entrano solo i bonifici che il server ha segnato sull'ordine
 *    (`bonificiDeiResiDagliOrdini`): non resta niente da controllare.
 *  · Sesto giro: dove arriva l'IBAN. Il cliente lo manda dalla pagina Contatti,
 *    e quei messaggi chi amministra li legge in Supporto — anche quello mandato
 *    quando il reso era ancora aperto e l'IBAN non aveva ancora un posto qui.
 */
export function cosaDiceLaVoce(
  voce: Pick<VoceDaBonificare, 'daFare' | 'iban' | 'daRegistrareSulReso'>,
  migrazione162: boolean,
): {
  alPostoDellIban: string | null;
  campoPerLIban: boolean;
  /** Riesame del 16/10, quarto giro: il rimborso non e' ancora scritto sul reso. */
  sulReso: string | null;
} {
  const campoPerLIban = voce.daFare && !voce.iban && migrazione162;
  const doveArriva =
    "IBAN non indicato. Il cliente lo manda dalla pagina Contatti, e i messaggi arrivano in Supporto: " +
    "guarda anche quelli di prima del rimborso. L'email di rimborso glielo chiede.";
  let alPostoDellIban: string | null = null;
  if (!voce.iban) {
    if (!voce.daFare) alPostoDellIban = 'IBAN cancellato dopo il bonifico.';
    else if (campoPerLIban) alPostoDellIban = `${doveArriva} Quando lo trovi, scrivilo qui.`;
    else alPostoDellIban = `${doveArriva} Finché sul database manca la migrazione 162 non si può salvare qui: tienilo a parte.`;
  }
  return {
    alPostoDellIban,
    campoPerLIban,
    sulReso:
      voce.daFare && voce.daRegistrareSulReso
        ? "Il rimborso è partito ma sul reso non si era registrato: la cifra viene dall'ordine. Quando segni il bonifico fatto, lo registriamo anche sul reso."
        : null,
  };
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
        : // Quinto giro del riesame: qui si chiedeva di scrivere sul reso il riferimento del
          // rimborso, ma nessuna pagina del pannello scrive sui resi. Sesto giro: diceva anche
          // «se il negozio prova a rimborsare di nuovo, fermalo», ma chi amministra non lo vede
          // succedere e dal pannello un reso non si blocca. Si chiede la cosa che si puo' fare:
          // avvisare il negozio, che si trova dall'ordine e si contatta da Utenti.
          'Non va rifatto: è già partito. Dal pannello il reso non si blocca e il riferimento non si scrive: ' +
          'avvisa tu il negozio di non rimborsarlo di nuovo e di non chiuderlo senza rimborso. ' +
          "Il negozio è scritto nell'ordine, i suoi recapiti in Utenti."),
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

/**
 * IL BONIFICO DI UN RESO CHE LA LISTA NON PUO' MOSTRARE (riesame del 16/10, sesto giro).
 *
 * La lista prende i bonifici dei resi solo dai segni sull'ordine (`bonificiDeiResiDagliOrdini`).
 * Se `refundOrder` non riesce a scrivere il segno nell'elenco dei rimborsi dell'ordine, il bonifico
 * e' dovuto ma in lista non c'e'. Prima finiva fra quelli «da controllare», con l'istruzione di non
 * pagarlo se un avviso non si trovava: adesso chi amministra riceve QUESTO avviso, al posto di
 * «Bonifico di rimborso da fare», che diceva di trovarlo nella lista. `null` per un reclamo: il suo
 * bonifico sta in `bonifici_dei_reclami`, e la lista lo legge da li'.
 */
export function avvisoDelBonificoFuoriDallaLista(r: {
  chiave: string;
  ordineId: string;
  bonificoCents: number;
  /** Le ultime quattro cifre dell'IBAN che il cliente ha scritto nel modulo, se l'ha scritto. */
  ibanFinale?: string | null;
}): { titolo: string; testo: string; link: string } | null {
  const resoId = resoDelSegno(segnoDelBonifico(r.chiave, r.bonificoCents));
  if (!resoId || r.bonificoCents <= 0) return null;
  return {
    titolo: '⚠️ Bonifico di rimborso fuori dalla lista',
    testo:
      `Bonifico di ${formatPriceFromCents(r.bonificoCents)} da fare al cliente dell'ordine #${r.ordineId.slice(0, 8)} ` +
      `(reso ${resoId}), pagato in contanti. Il database non ha registrato il rimborso sull'ordine. ` +
      'La lista dei bonifici da fare li prende solo da lì: questo non c\'è, e non ha il pulsante «fatto». ' +
      'Il rimborso è dovuto: fallo partendo da questo avviso e tieni il conto a parte. ' +
      (r.ibanFinale
        ? `Il cliente ha indicato un IBAN che finisce con ${r.ibanFinale}, ma dal pannello non si legge: ` +
          'chiedigli di rimandarlo dalla pagina Contatti e controlla che finisca così.'
        : 'Il cliente non ha indicato un IBAN: chiediglielo dalla pagina Contatti prima di pagare.'),
    // I messaggi dei Contatti, dove arriva l'IBAN, chi amministra li legge in Supporto.
    link: '/admin/support',
  };
}

/**
 * COSA RESTA NEL REGISTRO DELLE AZIONI (riesame del 16/10, sesto giro).
 *
 * Il registro diceva solo «IBAN salvato» e «bonifico fatto»: col «fatto» l'IBAN si cancella, e su
 * quale conto erano andati i soldi non lo diceva piu' niente. Adesso restano le ultime quattro
 * cifre del conto — il minimo per riconoscerlo, non l'IBAN — e, col «fatto», la cifra pagata.
 */
export function notaPerIlRegistro(
  azione: 'fatto' | 'iban',
  bonifico: { iban: string | null | undefined; cifraCents?: number | null },
): { passo: string; conto: string | null; cifra_cents?: number | null } {
  const conto = finale(bonifico.iban ?? null);
  return azione === 'iban'
    ? { passo: 'iban_del_bonifico_registrato', conto }
    : { passo: 'bonifico_di_rimborso_fatto', conto, cifra_cents: bonifico.cifraCents ?? null };
}

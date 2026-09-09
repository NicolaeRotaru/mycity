/**
 * QUALI TENTATIVI ABBANDONATI GUARDARE — E COSA FARE QUANDO NON SI È POTUTO
 * GUARDARE.
 *
 * ── I due difetti che hanno prodotto questo file (8/9/2026) ─────────────────
 * ① **Il cancello diventava cieco oltre dieci righe.** La lettura dei tentativi
 *    aperti chiedeva al database le prime dieci righe `PENDING` di quel
 *    cliente — `.limit(10)`, per giunta senza dire in che ordine — e solo DOPO,
 *    in JavaScript, teneva quelle che impegnavano i prodotti di questo
 *    carrello. Le due cose insieme fanno un buco: se il cliente ha undici
 *    tentativi aperti e quello che blocca la sua torta è l'undicesimo, il
 *    database non lo manda mai, il filtro non lo vede mai, e la pagina di
 *    pagamento vecchia resta viva mentre se ne apre una nuova. È il doppio
 *    addebito, riaperto dalla porta di servizio. Senza `.order()` non era
 *    nemmeno prevedibile QUALI dieci arrivassero: due chiamate uguali potevano
 *    dare due risposte diverse.
 * ② **Quando la lettura falliva si rispondeva «niente di pagabile».** Che è il
 *    verso opposto a quello giusto: chi legge quella risposta apre la cassa.
 *    «Non ho trovato pagine pagabili» e «non ho potuto guardare» sono due cose
 *    diverse, e su una sola delle due si può incassare.
 *
 * ── La cura ─────────────────────────────────────────────────────────────────
 * Non basta alzare il tetto: qualunque tetto, prima o poi, taglia qualcosa in
 * silenzio. Qui il tetto c'è ancora — un cliente con duecento pagamenti aperti
 * è una macchina impazzita, non una persona — ma **superarlo non è più un
 * taglio silenzioso: è un «non ho potuto guardare»**, cioè un motivo per NON
 * incassare. Si chiede una riga in più del tetto proprio per accorgersi di
 * averlo superato.
 *
 * L'ordine con cui si esaminano i tentativi non è più quello che capita: si
 * guardano prima i più recenti (`created_at` a scendere, a parità l'id). Il
 * riordino si fa qui, in memoria, perché a questo punto le righe ci sono
 * TUTTE: quando non ci sono tutte non si sceglie quali guardare, si blocca.
 *
 * ── La scelta, quando si è nel dubbio ───────────────────────────────────────
 * Fra «vado avanti e forse addebito due volte» e «mi fermo e forse faccio
 * riprovare qualcuno per niente», si sceglie sempre la seconda. Un ordine
 * rifiutato si recupera in trenta secondi con un «riprova» che al secondo giro
 * funziona; un addebito doppio si scopre dopo giorni, si rimborsa perdendo la
 * commissione fissa, e chi l'ha subito non torna.
 */

/** Il tentativo aperto, come arriva da `pending_checkouts`. */
export type RigaTentativo = {
  id: string;
  created_at?: string | null;
  groups?: Array<{ items?: Array<{ productId: string; quantity: number; variantId?: string | null }> }> | null;
  coupon_code?: string | null;
  stripe_session_id?: string | null;
  delivery?: { impronta_carrello?: string | null } | null;
};

/**
 * Quanti tentativi aperti si accetta di esaminare per un solo cliente.
 * Oltre questo numero non si tira a indovinare su quali guardare: ci si ferma.
 */
export const TETTO_TENTATIVI_APERTI = 200;

/**
 * Il segnaposto che finisce fra le sessioni «ancora pagabili» quando non si è
 * potuto guardare. Non è l'identificativo di una sessione vera: è il modo di
 * dire «potrebbe esserci una pagina viva e non lo so», detto nell'unica lingua
 * che i tre cancelli a valle capiscono già — `ordineInContantiPuoNascere`,
 * `laStradaELibera`, `riusoDellaCassaAperta` si fermano tutti quando questa
 * lista non è vuota, senza bisogno di imparare niente di nuovo.
 */
export const SESSIONE_NON_GUARDATA = 'ignota:tentativi-non-letti';

export type EsitoSelezione =
  | { guardati: true; candidati: RigaTentativo[] }
  | {
      guardati: false;
      perche: 'lettura_fallita' | 'troppi_tentativi';
      dettaglio: string;
    };

/** I prodotti impegnati da un tentativo, appiattiti. */
function prodottiDi(riga: RigaTentativo): string[] {
  return (riga.groups ?? []).flatMap((g) => (g.items ?? []).map((it) => it.productId));
}

/**
 * Dalle righe lette (o dal fallimento della lettura) ai tentativi da liberare.
 *
 * @param lettura.righe    Le righe tornate dal database. Se ne arrivano più del
 *   tetto vuol dire che il tetto è stato superato: la lettura si chiede sempre
 *   con una riga in più apposta.
 * @param lettura.errore   L'errore del database, se c'è stato.
 * @param filtro.improntaDaTenere  Il carrello che si sta comprando ADESSO: quello
 *   non si tocca (lo gestisce il riuso della sessione).
 * @param filtro.soloConProdotti   Si guardano solo i tentativi che impegnano
 *   almeno uno di questi prodotti. Una lista VUOTA vuol dire «nessun prodotto in
 *   comune», quindi nessun candidato — non «tutti».
 */
export function tentativiApertiDaLiberare(
  lettura: {
    righe?: RigaTentativo[] | null;
    errore?: { message?: string } | null;
    tetto?: number;
  },
  filtro: { improntaDaTenere?: string | null; soloConProdotti?: string[] | null },
): EsitoSelezione {
  if (lettura.errore) {
    return {
      guardati: false,
      perche: 'lettura_fallita',
      dettaglio: lettura.errore.message ?? 'errore senza messaggio',
    };
  }

  const tetto = lettura.tetto ?? TETTO_TENTATIVI_APERTI;
  const righe = lettura.righe ?? [];
  if (righe.length > tetto) {
    return {
      guardati: false,
      perche: 'troppi_tentativi',
      dettaglio: `almeno ${righe.length} tentativi aperti, tetto ${tetto}`,
    };
  }

  // Prima i più recenti: sono quelli che hanno più probabilità di avere ancora
  // una pagina di pagamento viva. A parità di istante decide l'id, così due
  // esecuzioni sullo stesso stato fanno le stesse cose nello stesso ordine.
  const ordinate = [...righe].sort((a, b) => {
    const ta = a.created_at ?? '';
    const tb = b.created_at ?? '';
    if (ta !== tb) return ta < tb ? 1 : -1;
    return String(a.id) < String(b.id) ? -1 : 1;
  });

  const cercati = filtro.soloConProdotti ? new Set(filtro.soloConProdotti) : null;
  const candidati = ordinate.filter(
    (r) =>
      (r.delivery?.impronta_carrello ?? null) !== (filtro.improntaDaTenere ?? null) &&
      (!cercati || prodottiDi(r).some((id) => cercati.has(id))),
  );

  return { guardati: true, candidati };
}

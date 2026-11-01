import {
  raccogliAFinestre, righeCsvConAvviso, contenutoCsv, nomeFileCsv, pezzoNomeFile, fraseSenzaId,
} from '@/lib/admin/esporta-csv';

/**
 * 8/9/2026 - IL FILE PER IL COMMERCIALISTA CONTENEVA GLI ULTIMI CINQUANTA
 * ORDINI E NON LO DICEVA.
 *
 * -- Come si era rotto -------------------------------------------------------
 * La pagina /admin/orders carica cinquanta ordini per volta, con il pulsante
 * «Carica altri 50». Il pulsante «Esporta CSV» scriveva nel file quello che era
 * gia' a schermo: `filtered`. Chi non aveva premuto «Carica altri» scaricava un
 * file di cinquanta righe. Il file si chiamava `mycity-ordini-2026-09-06.csv` e
 * dentro non c'era una parola che dicesse che era un pezzo. A fine mese il
 * commercialista ci fa le somme sopra: sbagliate per difetto, e senza un
 * segnale che glielo faccia sospettare. Oggi con pochi ordini non morde. Morde
 * il giorno in cui gli ordini sono tanti, cioe' quando conta.
 *
 * -- La cura, in due pezzi ---------------------------------------------------
 * ① L'esportazione non guarda piu' quello che sta a schermo: fa una lettura
 *    sua, a finestre, finche' il database non le dice che sono finiti. Quello
 *    che c'e' in pagina e quello che c'e' nel file smettono di essere legati.
 * ② Se per qualunque motivo non si arriva in fondo (il tetto di sicurezza), il
 *    file NON puo' sembrare completo: `contenutoCsvOrdini` scrive un avviso in
 *    prima riga e il nome del file porta `-PARZIALE`. La strada per ottenere il
 *    testo del CSV passa da `RaccoltaOrdini`, che il collezionatore riempie:
 *    un elenco monco che si spaccia per intero bisognerebbe fabbricarlo apposta.
 *
 * Qui dentro non c'e' niente di Supabase e niente di React: la lettura arriva
 * come funzione (`LettoreDiOrdini`), quindi una prova puo' eseguire tutto senza
 * database e senza browser.
 */

/** La forma minima che serve per scrivere una riga del file. */
export type OrdineDaEsportare = {
  id: string;
  created_at: string;
  delivery_full_name: string | null;
  delivery_city: string | null;
  delivery_status: string;
  total_price: number | string | null;
  seller: { store_name: string | null } | null;
  rider: { full_name: string | null } | null;
};

/** Le colonne, nell'ordine in cui il commercialista se le aspetta. */
export const INTESTAZIONI_CSV_ORDINI = [
  'ID', 'Data', 'Cliente', 'Città', 'Negozio', 'Rider', 'Stato', 'Totale €',
] as const;

/** Quanti ordini per lettura. Mille e' il tetto per richiesta di PostgREST. */
export const ORDINI_PER_LETTURA = 1000;

/**
 * Quante letture al massimo: 60 x 1000, cioe' cinquantanovemila ordini piu' la
 * lettura vuota che dice «sono finiti». E' una cintura, non un limite atteso.
 */
export const TETTO_LETTURE = 60;

/** La lettura di una finestra di ordini: estremi inclusi, come `.range()`. */
export type LettoreDiOrdini = (da: number, a: number) => Promise<OrdineDaEsportare[]>;

export type RaccoltaOrdini = {
  righe: OrdineDaEsportare[];
  /** Vero solo se il database ha detto «sono finiti», non se ci siamo stancati. */
  completo: boolean;
  letture: number;
  /** `senza-id`: righe arrivate senza identificativo, contate e lasciate fuori. */
  motivo?: 'tetto' | 'senza-id';
  senzaId?: number;
};

/**
 * L'importo come lo vuole Excel in italiano: due decimali con la virgola.
 * (6/9/2026 - col punto arrivava in cella come parola e la colonna non si
 * sommava.)
 */
export function importoPerExcel(valore: number | string | null): string {
  const numero = Number(valore);
  if (!Number.isFinite(numero)) return '';
  return numero.toFixed(2).replace('.', ',');
}

/** Una riga del file, nell'ordine delle intestazioni. */
export function rigaCsvOrdine(o: OrdineDaEsportare): unknown[] {
  return [
    o.id,
    o.created_at,
    o.delivery_full_name ?? '',
    o.delivery_city ?? '',
    o.seller?.store_name ?? '',
    o.rider?.full_name ?? '',
    o.delivery_status,
    importoPerExcel(o.total_price),
  ];
}

/**
 * Legge tutti gli ordini a finestre. L'algoritmo (fine a «zero righe»,
 * doppioni tolti per id, righe senza id contate e lasciate fuori, tetto) sta in
 * `lib/admin/esporta-csv.ts`, lo stesso degli utenti: qui c'è solo il tetto.
 * Nel file del commercialista un ordine contato due volte è una somma gonfiata.
 */
export async function raccogliOrdiniDaEsportare(
  leggi: LettoreDiOrdini,
  opzioni: { perLettura?: number; tettoLetture?: number } = {},
): Promise<RaccoltaOrdini> {
  return raccogliAFinestre(leggi, {
    perLettura: opzioni.perLettura ?? ORDINI_PER_LETTURA,
    tettoLetture: opzioni.tettoLetture ?? TETTO_LETTURE,
  });
}

/**
 * L'avviso che sta in prima riga quando l'elenco non e' completo. Con
 * `motivo === 'senza-id'` la lettura e' arrivata in fondo: si parla solo delle
 * righe senza identificativo, non di un «resto non scaricato» che non c'e'.
 */
export function avvisoFileParziale(quante: number, senzaId = 0, motivo?: RaccoltaOrdini['motivo']): string {
  const dettaglio = motivo === 'senza-id'
    ? `Qui dentro ci sono ${quante} ordini, letti fino in fondo.`
    : `Qui dentro ci sono solo i primi ${quante} ordini, il resto non e' stato scaricato.`;
  return `ATTENZIONE: elenco INCOMPLETO. ${dettaglio}${fraseSenzaId(senzaId)} NON usare questo file per la contabilita': rifai l'esportazione o chiedi l'elenco completo.`;
}

/** Le righe del file: l'avviso (se serve), le intestazioni, gli ordini. */
export function righeCsvOrdini(raccolta: RaccoltaOrdini): unknown[][] {
  return righeCsvConAvviso(raccolta, INTESTAZIONI_CSV_ORDINI, rigaCsvOrdine,
    () => avvisoFileParziale(raccolta.righe.length, raccolta.senzaId, raccolta.motivo));
}

/**
 * Il testo del file. Passa da `lib/csv-sicuro`, quindi ogni cella e' neutralizzata:
 * nessun nome scelto da un negoziante puo' diventare una formula eseguita.
 */
export function contenutoCsvOrdini(raccolta: RaccoltaOrdini): string {
  return contenutoCsv(righeCsvOrdini(raccolta));
}

/**
 * Il nome del file dice cosa c'e' dentro: la data, il filtro applicato, e
 * `-PARZIALE` quando l'elenco non e' completo.
 */
export function nomeFileOrdini(opzioni: { oggi: string; completo: boolean; filtro?: string }): string {
  const filtro = opzioni.filtro && opzioni.filtro !== 'all' ? pezzoNomeFile(opzioni.filtro) : '';
  return nomeFileCsv({ prefisso: 'mycity-ordini', oggi: opzioni.oggi, completo: opzioni.completo, pezzi: [filtro] });
}

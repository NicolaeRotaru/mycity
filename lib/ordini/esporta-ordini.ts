import { contenutoFileCsv } from '@/lib/csv-sicuro';

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
  motivo?: 'tetto';
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
 * Legge finestra dopo finestra finche' il database non restituisce PIU' NIENTE.
 *
 * Il criterio di fine e' «zero righe», non «meno righe di quante ne ho
 * chieste», e la differenza non e' accademica: PostgREST ha un tetto di righe
 * per richiesta (`max-rows`) che si cambia dal pannello di Supabase. Se quel
 * tetto e' piu' basso della finestra, la prima lettura torna corta e il criterio
 * furbo direbbe «sono finiti» - ricreando esattamente il file monco che sembra
 * intero. Si paga una lettura in piu' alla fine, quella vuota.
 *
 * L'avanzamento e' di quante righe sono arrivate davvero, non di quante ne
 * abbiamo chieste, se no il tetto del server farebbe saltare dei blocchi.
 *
 * I doppioni si tolgono per identificativo. Servono: mentre si sfoglia, un
 * ordine nuovo entra in cima e sposta tutte le righe di uno, cosi' la finestra
 * dopo ripesca l'ultima riga di quella prima. Nel file del commercialista un
 * ordine contato due volte e' una somma gonfiata.
 */
export async function raccogliOrdiniDaEsportare(
  leggi: LettoreDiOrdini,
  opzioni: { perLettura?: number; tettoLetture?: number } = {},
): Promise<RaccoltaOrdini> {
  const perLettura = Math.max(1, Math.trunc(opzioni.perLettura ?? ORDINI_PER_LETTURA));
  const tetto = Math.max(1, Math.trunc(opzioni.tettoLetture ?? TETTO_LETTURE));

  const perId = new Map<string, OrdineDaEsportare>();
  let letture = 0;
  let da = 0;

  for (let giro = 0; giro < tetto; giro++) {
    const blocco = await leggi(da, da + perLettura - 1);
    letture++;
    for (const ordine of blocco) {
      if (!perId.has(ordine.id)) perId.set(ordine.id, ordine);
    }
    if (blocco.length === 0) {
      return { righe: [...perId.values()], completo: true, letture };
    }
    da += blocco.length;
  }

  return { righe: [...perId.values()], completo: false, letture, motivo: 'tetto' };
}

/** L'avviso che sta in prima riga quando l'elenco non e' arrivato in fondo. */
export function avvisoFileParziale(quante: number): string {
  return `ATTENZIONE: elenco INCOMPLETO. Qui dentro ci sono solo i primi ${quante} ordini, il resto non e' stato scaricato. NON usare questo file per la contabilita': rifai l'esportazione o chiedi l'elenco completo.`;
}

/** Le righe del file: l'avviso (se serve), le intestazioni, gli ordini. */
export function righeCsvOrdini(raccolta: RaccoltaOrdini): unknown[][] {
  const testa: unknown[][] = raccolta.completo
    ? []
    : [[avvisoFileParziale(raccolta.righe.length)], []];
  return [...testa, [...INTESTAZIONI_CSV_ORDINI], ...raccolta.righe.map(rigaCsvOrdine)];
}

/**
 * Il testo del file. Passa da `componiCsv`, quindi ogni cella e' neutralizzata:
 * nessun nome scelto da un negoziante puo' diventare una formula eseguita.
 */
export function contenutoCsvOrdini(raccolta: RaccoltaOrdini): string {
  return contenutoFileCsv(righeCsvOrdini(raccolta));
}

/**
 * Il nome del file dice cosa c'e' dentro: la data, il filtro applicato, e
 * `-PARZIALE` quando l'elenco non e' completo.
 */
export function nomeFileOrdini(opzioni: { oggi: string; completo: boolean; filtro?: string }): string {
  const filtro = opzioni.filtro && opzioni.filtro !== 'all'
    ? `-${opzioni.filtro.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    : '';
  const parziale = opzioni.completo ? '' : '-PARZIALE';
  return `mycity-ordini-${opzioni.oggi}${filtro}${parziale}.csv`;
}

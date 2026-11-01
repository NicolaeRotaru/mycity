import { contenutoFileCsv } from '@/lib/csv-sicuro';

/**
 * 1/11/2026 — L'ESPORTAZIONE CSV ERA SCRITTA DUE VOLTE, E LE DUE COPIE AVEVANO
 * GIÀ COMINCIATO A DIRE COSE DIVERSE.
 *
 * ── Come si era rotto ───────────────────────────────────────────────────────
 * `lib/ordini/esporta-ordini.ts` e `lib/admin/esporta-utenti.ts` avevano lo
 * stesso algoritmo copiato a mano: finestre `.range()`, fine a «zero righe»,
 * doppioni tolti per identificativo, tetto di letture. Copiato, e già diverso:
 *  · gli utenti scartavano le righe senza id, gli ordini no (la prima riga
 *    senza id entrava nel file, le altre sparivano in silenzio);
 *  · il nome del file degli utenti toglieva gli accenti e i trattini ai bordi,
 *    quello degli ordini no: un filtro «Città » dava `mycity-ordini-…-citt--.csv`.
 * Ogni correzione futura andava fatta due volte; la terza esportazione che
 * qualcuno aggiunge l'avrebbe copiata di nuovo, con un'altra variante.
 *
 * ── La cura ─────────────────────────────────────────────────────────────────
 * Qui c'è UNA lettura a finestre (`raccogliAFinestre`), UN nome di file
 * (`nomeFileCsv`), UNA testa d'avviso (`righeCsvConAvviso`). Le due
 * esportazioni passano i loro pezzi (colonne, tetto, parole dell'avviso) e
 * nient'altro.
 *
 * ── La scelta sulle righe senza identificativo ──────────────────────────────
 * Una riga senza id non si può deduplicare: se la finestra dopo la ripesca,
 * non c'è modo di sapere che è la stessa. Tenerla vuol dire rischiare di
 * contarla due volte (un ordine doppio è una somma gonfiata per il
 * commercialista); buttarla in silenzio vuol dire un file monco che sembra
 * intero, cioè il difetto da cui queste esportazioni sono nate. Quindi: la riga
 * resta fuori, ma si CONTA (`senzaId`) e la raccolta smette di essere completa —
 * avviso in prima riga col numero e `-PARZIALE` nel nome. Oggi `id` è la chiave
 * primaria e non manca mai: se manca, si è rotta la lettura, e lo si deve vedere.
 */

/** Il minimo che serve per togliere i doppioni. */
export type RigaConId = { id?: string | null };

/** La lettura di una finestra: estremi inclusi, come `.range()`. */
export type LettoreAFinestre<T> = (da: number, a: number) => Promise<T[]>;

export type RaccoltaAFinestre<T> = {
  righe: T[];
  /** Vero solo se il database ha detto «sono finiti» E nessuna riga è rimasta fuori. */
  completo: boolean;
  letture: number;
  /** Perché non è completa: il tetto di letture, o righe arrivate senza id. */
  motivo?: 'tetto' | 'senza-id';
  /** Righe arrivate senza identificativo e lasciate fuori dal file. */
  senzaId?: number;
};

/**
 * Legge finestra dopo finestra finché il database non restituisce PIÙ NIENTE.
 *
 * Il criterio di fine è «zero righe», non «meno righe di quante ne ho chieste»:
 * PostgREST ha un suo tetto di righe per richiesta (`max-rows`) che si cambia dal
 * pannello di Supabase; se è più basso della finestra la prima lettura torna
 * corta e il criterio furbo direbbe «sono finiti» su un file monco. Si paga una
 * lettura in più, quella vuota. L'avanzamento è di quante righe sono arrivate
 * davvero, non di quante ne abbiamo chieste.
 *
 * I doppioni si tolgono per identificativo: mentre si sfoglia, una riga nuova
 * entra in cima e sposta tutte le altre di uno.
 */
export async function raccogliAFinestre<T extends RigaConId>(
  leggi: LettoreAFinestre<T>,
  opzioni: { perLettura: number; tettoLetture: number },
): Promise<RaccoltaAFinestre<T>> {
  const perLettura = Math.max(1, Math.trunc(opzioni.perLettura));
  const tetto = Math.max(1, Math.trunc(opzioni.tettoLetture));

  const perId = new Map<string, T>();
  let senzaId = 0;
  let letture = 0;
  let da = 0;

  const chiudi = (arrivatoInFondo: boolean): RaccoltaAFinestre<T> => {
    const righe = [...perId.values()];
    const base = senzaId > 0 ? { senzaId } : {};
    if (!arrivatoInFondo) return { righe, completo: false, letture, motivo: 'tetto', ...base };
    if (senzaId > 0) return { righe, completo: false, letture, motivo: 'senza-id', ...base };
    return { righe, completo: true, letture };
  };

  for (let giro = 0; giro < tetto; giro++) {
    const blocco = await leggi(da, da + perLettura - 1);
    letture++;
    for (const riga of blocco) {
      const id = riga?.id;
      if (typeof id !== 'string' || id === '') { senzaId++; continue; }
      if (!perId.has(id)) perId.set(id, riga);
    }
    if (blocco.length === 0) return chiudi(true);
    da += blocco.length;
  }
  return chiudi(false);
}

/** La frase che spiega le righe senza id lasciate fuori (vuota se non ce ne sono). */
export function fraseSenzaId(senzaId: number | undefined): string {
  if (!senzaId) return '';
  return senzaId === 1
    ? ' 1 riga è arrivata senza identificativo e non è nel file.'
    : ` ${senzaId} righe sono arrivate senza identificativo e non sono nel file.`;
}

/** Le righe del file: l'avviso in prima riga (se incompleto), le intestazioni, i dati. */
export function righeCsvConAvviso<T>(
  raccolta: { righe: readonly T[]; completo: boolean },
  intestazioni: readonly string[],
  riga: (r: T) => unknown[],
  avviso: () => string,
): unknown[][] {
  const testa: unknown[][] = raccolta.completo ? [] : [[avviso()], []];
  return [...testa, [...intestazioni], ...raccolta.righe.map(riga)];
}

/** Il testo del file: ogni cella passa da `lib/csv-sicuro`, nessuna formula eseguita. */
export function contenutoCsv(righe: unknown[][]): string {
  return contenutoFileCsv(righe);
}

/**
 * Un pezzo di nome file: minuscolo, senza accenti («città» → «citta»), ogni
 * altro carattere diventa un trattino, niente trattini ai bordi.
 */
export function pezzoNomeFile(testo: string, massimo?: number): string {
  const pulito = testo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const tagliato = massimo !== undefined ? pulito.slice(0, massimo) : pulito;
  return tagliato.replace(/-+$/g, '');
}

/**
 * Il nome del file dice cosa c'è dentro: `<prefisso>-<data>-<pezzi>[-PARZIALE].csv`.
 * I pezzi vuoti spariscono, così non nascono `--`.
 */
export function nomeFileCsv(opzioni: {
  prefisso: string;
  oggi: string;
  completo: boolean;
  pezzi?: readonly string[];
}): string {
  const pezzi = (opzioni.pezzi ?? []).filter((p) => p !== '').map((p) => `-${p}`).join('');
  const parziale = opzioni.completo ? '' : '-PARZIALE';
  return `${opzioni.prefisso}-${opzioni.oggi}${pezzi}${parziale}.csv`;
}

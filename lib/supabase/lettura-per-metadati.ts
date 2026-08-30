import type { SupabaseClient } from '@supabase/supabase-js';
import { creaClientAnonimo } from '@/lib/supabase/anonimo';

/**
 * LA RIGA CHE SERVE AI METADATI DI UNA PAGINA — letta in un posto solo, e senza silenzi.
 *
 * 27/8/2026 (R010) — sotto `app/` c'erano nove punti che si costruivano il client Supabase a mano,
 * con la forma vecchia: leggevano `process.env` grezzo e, se mancava qualcosa, facevano
 * `return null` senza dire niente. Quattro di quei nove erano perfino la stessa funzione — «leggi
 * una riga e costruisci i metadati» — copiata con nomi diversi.
 *
 * Il modo in cui si rompeva è la parte peggiore: con le variabili sbagliate o assenti, la pagina
 * del negozio non si lamentava. Restituiva `null`, e Google riceveva «Negozio non trovato» con
 * `noindex` su schede vere. Nessun errore nei log, nessun allarme: le pagine dei negozi sparivano
 * dalla ricerca e nessuno lo sapeva.
 *
 * `creaClientAnonimo()` invece LANCIA, e dice quali variabili mancano. Una pagina che si rompe
 * rumorosamente si aggiusta in un'ora; una che sparisce da Google in silenzio no.
 *
 * La riga assente resta `null`: quello è il caso normale (uno slug morto, un prodotto cancellato) e
 * i metadati sanno già cosa farne.
 *
 * ── 27/8/2026 (R082) — LA STESSA RIGA LETTA DUE VOLTE PER OGNI APERTURA ─────────────────────────
 * `app/product/[id]/layout.tsx` chiama questa lettura due volte nello stesso giro: una in
 * `generateMetadata`, una nel componente. Sono due letture vere, sulla pagina più aperta del sito.
 * In React 19 ci sarebbe `cache()`; qui React è ancora il 18 (`typeof React.cache === 'undefined'`),
 * quindi la memoria è questa: due secondi, la stessa domanda, una risposta sola. È una finestra
 * molto più stretta della cache che queste pagine già dichiarano (`revalidate = 300`, cinque
 * minuti), quindi non rende niente più vecchio di quanto già fosse; e le righe qui dentro sono
 * pubbliche — prodotto, negozio, categoria — mai roba di una persona.
 */

/** Quanto vive la risposta in memoria: il tempo di una richiesta, non di più. */
const MEMORIA_MS = 2_000;

type VoceDiMemoria = { quando: number; riga: Promise<unknown> };
const memoria = new Map<string, VoceDiMemoria>();

export async function leggiPerMetadati<T>(
  tabella: string,
  colonne: string,
  dove: Record<string, string>,
  client?: SupabaseClient,
): Promise<T | null> {
  const chiave = JSON.stringify([tabella, colonne, dove]);
  const adesso = Date.now();

  const gia = memoria.get(chiave);
  if (gia && adesso - gia.quando < MEMORIA_MS) return gia.riga as Promise<T | null>;

  const lettura = (async () => {
    const supabase = client ?? creaClientAnonimo();
    let q = supabase.from(tabella).select(colonne);
    for (const [colonna, valore] of Object.entries(dove)) q = q.eq(colonna, valore);
    const { data } = await q.single();
    return (data as T | null) ?? null;
  })();

  // Una lettura fallita non resta in memoria: al prossimo giro si riprova davvero.
  lettura.catch(() => memoria.delete(chiave));

  memoria.set(chiave, { quando: adesso, riga: lettura });
  if (memoria.size > 200) {
    for (const [k, v] of memoria) if (adesso - v.quando >= MEMORIA_MS) memoria.delete(k);
  }
  return lettura as Promise<T | null>;
}

/** Svuota la memoria. Serve alle prove: nel sito vero scade da sola in due secondi. */
export function dimenticaLettureDeiMetadati(): void {
  memoria.clear();
}

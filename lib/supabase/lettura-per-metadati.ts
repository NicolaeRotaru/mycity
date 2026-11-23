import * as React from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { creaClientAnonimo } from '@/lib/supabase/anonimo';
import { logger } from '@/lib/logger';

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
 * La memoria qui sotto: due secondi, la stessa domanda, una risposta sola. Le pagine dichiarano un
 * `revalidate`, ma `force-dynamic` in app/layout.tsx le rende dinamiche: una cache di cinque minuti
 * oggi non c'è, e due secondi sono meno di quanto chiunque noti. Le righe qui dentro sono pubbliche
 * — prodotto, negozio, categoria — mai roba di una persona.
 *
 * Nota (collaudo del 22/11): la lettura del precarico (lib/queries/precarico.ts) è una domanda
 * diversa e NON passa da qui. Per questo, dal 22/11, la scheda prodotto e la vetrina prendono i
 * campi dei metadati dalla risposta del precarico (una per richiesta) e passano da qui solo quando
 * il precarico non ha la riga.
 *
 * ── 21/11/2026 (R10-016) — UNA LETTURA PER RICHIESTA, NON PER DUE SECONDI ──────────────────────
 * Qui c'era scritto che `cache()` non c'è perché React è il 18. Vale per le prove e per il vecchio
 * router, non per i componenti del server: lì Next usa il suo React (il 19), e `React.cache` c'è.
 * Due secondi non sono «una richiesta»: se la prima risposta tarda (un database lento, un avvio a
 * freddo), il guscio arriva dopo la scadenza e rilegge la stessa riga che `generateMetadata` ha
 * appena letto. Adesso, sopra la memoria a due secondi, c'è quella di React: per tutta la richiesta
 * la stessa domanda ha una risposta sola, qualunque cosa duri. La memoria a due secondi resta per
 * le richieste vicine fra loro. Dove `cache` non c'è (le prove, col React 18 del progetto) la si
 * salta e basta; fuori dai componenti del server React la lascia passare senza memoria.
 */
type Memorizzatore = <F extends (...argomenti: never[]) => unknown>(f: F) => F;
const cacheDiReact = (React as unknown as { cache?: Memorizzatore }).cache;
const perRichiesta: Memorizzatore = (f) => (typeof cacheDiReact === 'function' ? cacheDiReact(f) : f);

/** Quanto vive la risposta in memoria: il tempo di una richiesta, non di più. */
const MEMORIA_MS = 2_000;

type VoceDiMemoria = { quando: number; riga: Promise<unknown> };
const memoria = new Map<string, VoceDiMemoria>();

/**
 * La stessa domanda nella stessa richiesta: una lettura sola. La chiave è un testo perché `cache`
 * riconosce gli oggetti per identità, e `dove` è un oggetto nuovo a ogni chiamata.
 */
const letturaDellaRichiesta = perRichiesta((chiave: string): Promise<unknown> => {
  const [tabella, colonne, dove] = JSON.parse(chiave) as [string, string, Record<string, string>];
  return leggiConMemoria(chiave, tabella, colonne, dove);
});

export async function leggiPerMetadati<T>(
  tabella: string,
  colonne: string,
  dove: Record<string, string>,
  client?: SupabaseClient,
): Promise<T | null> {
  const chiave = JSON.stringify([tabella, colonne, dove]);
  // Con un client passato da fuori (le anteprime, le prove) la memoria di React non si usa: la
  // chiave non saprebbe distinguere due client diversi.
  if (client) return leggiConMemoria(chiave, tabella, colonne, dove, client) as Promise<T | null>;
  return letturaDellaRichiesta(chiave) as Promise<T | null>;
}

function leggiConMemoria(
  chiave: string,
  tabella: string,
  colonne: string,
  dove: Record<string, string>,
  client?: SupabaseClient,
): Promise<unknown> {
  const adesso = Date.now();

  const gia = memoria.get(chiave);
  if (gia && adesso - gia.quando < MEMORIA_MS) return gia.riga;

  const lettura = (async () => {
    const supabase = client ?? creaClientAnonimo();
    let q = supabase.from(tabella).select(colonne);
    for (const [colonna, valore] of Object.entries(dove)) q = q.eq(colonna, valore);
    // S10 (5/11/2026) — Prima l'errore si buttava: un tempo scaduto o un 503
    // diventavano «riga assente», e la pagina diceva a Google «non trovato»
    // (noindex) per una scheda vera. Adesso solo «nessuna riga» e' null; un
    // guasto lancia, la pagina va in errore e non si scrive niente di falso.
    const { data, error } = await q.single();
    // PGRST116 = nessuna riga: quello si' che e' «non trovato».
    // 22P02 = valore non valido per il tipo (un id che non e' un UUID): non esiste.
    const codice = (error as { code?: string } | null)?.code;
    if (error && codice !== 'PGRST116' && codice !== '22P02') {
      logger.warn('[metadati] lettura non riuscita: non la tratto come «non trovato»', { tabella, code: error.code });
      throw error;
    }
    return data ?? null;
  })();

  // Una lettura fallita non resta in memoria: al prossimo giro si riprova davvero.
  lettura.catch(() => memoria.delete(chiave));

  memoria.set(chiave, { quando: adesso, riga: lettura });
  if (memoria.size > 200) {
    for (const [k, v] of memoria) if (adesso - v.quando >= MEMORIA_MS) memoria.delete(k);
  }
  return lettura;
}

/** Svuota la memoria. Serve alle prove: nel sito vero scade da sola in due secondi. */
export function dimenticaLettureDeiMetadati(): void {
  memoria.clear();
}

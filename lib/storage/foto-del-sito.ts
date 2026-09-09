/**
 * COSA CHIEDIAMO AL DEPOSITO QUANDO IL NEGOZIANTE CARICA UNA FOTO DELLA SUA VETRINA.
 *
 * ── Perche' esiste, con la data ──────────────────────────────────────────────────────────────
 * 8/9/2026. Questa richiesta era scritta dentro `uploadSiteImage`, in
 * `components/seller/site/ImageUpload.tsx`: un file `'use client'` che tira dentro React,
 * react-dropzone, sonner e il client Supabase. Una prova non poteva eseguirla — e infatti la sola
 * cosa che sapevo verificare era che nel sorgente comparisse un nome. **Provato, e non provava
 * niente**: togliendo la correzione del tipo e lasciando la riga `import`, la prova restava verde.
 *
 * Qui invece si esegue. La riga che conta e' una sola, `fileColTipoGiusto(file)`, ed e' quella che
 * fa arrivare davvero la foto scattata con l'iPhone: nel browser il tipo che viaggia e' quello del
 * `File`, non l'opzione `contentType` della chiamata, e un HEIC trascinato da un PC ha `type`
 * vuoto — parte come `application/octet-stream` e il deposito lo rifiuta.
 *
 * 🟢 Modulo PURO: costruisce un oggetto e basta. Nessuna rete, nessun React, nessun client.
 */

import { ANNO_IN_SECONDI, type RichiestaCaricamento } from './carica-immagine';
import { fileColTipoGiusto } from './casella-di-caricamento';

/** La sotto-cartella dove finiscono gli asset della vetrina, dentro la cartella di chi carica. */
export const CARTELLA_DEL_SITO = 'site';

/**
 * La richiesta di caricamento per una foto della vetrina.
 *
 * Il percorso non lo costruisce nessuno qui: lo costruisce la porta (`caricaImmagine`) a partire
 * da `userId` e `cartella`. Questa funzione decide le uniche due cose che restano da decidere —
 * il tipo vero del file, e per quanto tempo si puo' tenere in cache.
 */
export function richiestaPerIlSito(file: File, userId: string): RichiestaCaricamento {
  return {
    file: fileColTipoGiusto(file),
    userId,
    cartella: CARTELLA_DEL_SITO,
    cacheControl: ANNO_IN_SECONDI,
  };
}

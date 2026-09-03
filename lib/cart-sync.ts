'use client';

import type { CartItem } from '@/lib/cart';
import type { Database } from '@/lib/database.types';
import { erroreDaFornitoreMuto } from '@/lib/auth/decisione-portiere';
import {
  COLONNE_148,
  scriviAncheSeMancaUnaColonnaNuova,
  type EsitoScrittura,
} from '@/lib/db/migrazione-148';

/**
 * LA COPIA DEL CARRELLO SUL SERVER — quella che serve a dire «hai dimenticato
 * qualcosa», e a sapere se quel messaggio ha funzionato.
 *
 * Sta in un file suo, e non più dentro `lib/cart.ts`, per un motivo pratico:
 * era una funzione privata e nessuna prova poteva guardarla lavorare.
 *
 * ── 30/8/2026 (R164) — IL RECUPERO CARRELLI NON ERA MISURABILE ──────────────
 *
 * La tabella `abandoned_carts` ha da sempre una colonna `recovered`, e la
 * funzione che sceglie chi ricontattare filtra su `recovered = false`. Ma quel
 * `true` non lo scriveva nessuno, in nessun punto del progetto: la colonna era
 * nata e rimasta a zero.
 *
 * Il motivo era qui dentro: alla fine di un ordine il browser chiama
 * `clearCart()`, che chiamava questa funzione con il carrello vuoto — e il
 * carrello vuoto voleva dire CANCELLA LA RIGA. Il carrello recuperato spariva
 * nell'istante esatto in cui diventava una notizia. Risultato: la campagna di
 * recupero — una delle poche leve di ricavo già costruite — girava alla cieca.
 * Non si poteva sapere quanto rendeva, quindi non si poteva decidere se
 * tenerla, cambiarla o spegnerla.
 *
 * Adesso «vuoto perché ha comprato» e «vuoto perché ha tolto tutto» sono due
 * cose diverse: la prima marca la riga come recuperata (e il filtro
 * `recovered = false` la esclude dai prossimi invii), la seconda cancella.
 *
 * Secondo effetto riparato: l'upsert non azzerava `recovery_email_sent_at`,
 * e la funzione di scelta pretende che sia NULL. Chi riceveva l'email e non
 * comprava non ne riceveva più una, qualunque cosa mettesse nel carrello dopo:
 * la riga restava lì, marcata per sempre. Ora un carrello con dentro roba
 * diversa è un carrello nuovo, e può tornare in coda — non subito, perché la
 * scelta vuole comunque quattro ore di inattività.
 *
 * ── 3/9/2026 — DUE MODI DI PERDERE IL CARRELLO IN SILENZIO ──────────────────
 *
 * Qui si scriveva e non si guardava mai com'era andata. Il database non lancia
 * quando rifiuta: restituisce un errore dentro la risposta. Quell'errore non lo
 * leggeva nessuno, e il `catch` in fondo al file non c'entrava niente — su una
 * scrittura rifiutata non ci passa mai. Da lì due guasti veri, tutti e due
 * muti:
 *
 *  1. UNA COLONNA CHE IN PRODUZIONE NON C'È ANCORA FA CADERE TUTTA LA
 *     SCRITTURA. `recovered_at` arriva con la migrazione 148, e le migrazioni
 *     si applicano a mano: fra il momento in cui il codice va online e la firma
 *     su quella migrazione passa del tempo. In quel tempo il salvataggio del
 *     carrello falliva per intero — non «senza quella colonna»: per intero. Chi
 *     metteva la spesa nel carrello non la ritrovava sull'altro dispositivo, e
 *     chi aveva appena comprato restava «non recuperato», cioè in coda per
 *     l'email «hai dimenticato qualcosa» il mattino dopo aver pagato.
 *
 *  2. «IL SERVIZIO DI ACCESSO NON RISPONDE» VENIVA SCAMBIATO PER «NON HA FATTO
 *     L'ACCESSO». Si usciva in silenzio e la copia sul server restava indietro.
 *     È lo stesso sbaglio del portiere del sito, riparato il 3/9 in
 *     `lib/auth/decisione-portiere.ts`: qui si CHIAMA quella regola, non se ne
 *     scrive una seconda. Due copie della stessa regola divergono, e il giorno
 *     in cui una si comporta male nessuno sa quale delle due sta guardando.
 *
 * LA REGOLA NUOVA, IN UNA FRASE: le colonne che servono a MISURARE non possono
 * portarsi dietro quelle che servono a NON SBAGLIARE. Se la scrittura completa
 * viene rifiutata perché una colonna non esiste ancora, si riscrive senza
 * quella e si lascia detto nei log: chi ha comprato risulta comunque tornato, e
 * il carrello messo da parte resta al suo posto.
 *
 * Quella regola sta scritta una volta sola, in
 * `lib/db/migrazione-148.ts`, perché lo stesso identico guasto
 * ce l'ha il gemello sul server (`lib/carrelli-abbandonati.ts`): due copie
 * divergono, e il giorno in cui una si comporta male nessuno sa quale delle due
 * sta guardando.
 */

/**
 * I nomi dei campi che scriviamo sono quelli veri della tabella, presi dai tipi
 * generati da `migrations/`. Se una migrazione toglie o rinomina una colonna,
 * `npx tsc --noEmit` diventa rosso QUI, prima che se ne accorga un cliente.
 */
type CampiCarrello = Partial<
  Record<keyof Database['public']['Tables']['abandoned_carts']['Row'], unknown>
>;

/**
 * Un avviso nei log, senza far cadere niente: qui siamo sempre best-effort.
 * Il logger si carica solo quando c'è davvero qualcosa da dire, come si fa già
 * in questo file col client del database.
 */
async function avvisa(messaggio: string): Promise<void> {
  try {
    const { logger } = await import('@/lib/logger');
    logger.warn(messaggio);
  } catch {
    /* nemmeno l'avviso può rompere il carrello di chi sta comprando */
  }
}

/** Scrive e, se serve, riprova senza le colonne nuove; poi mette l'avviso nei log. */
async function scrivi(
  cosa: string,
  campi: CampiCarrello,
  esegui: (campi: Record<string, unknown>) => PromiseLike<EsitoScrittura>,
): Promise<void> {
  const esito = await scriviAncheSeMancaUnaColonnaNuova(cosa, campi, COLONNE_148, esegui);
  if (esito.avviso) await avvisa(esito.avviso);
}

/** Quanto vale la roba nel carrello, in euro. */
type Opzioni = {
  totale: number;
  /**
   * Vuoto PERCHÉ ha comprato. Cambia tutto: la riga non si cancella, si marca
   * come recuperata — altrimenti la vittoria non la conta nessuno.
   */
  dopoUnOrdine?: boolean;
};

export async function syncAbandonedCart(items: CartItem[], opzioni: Opzioni): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const { supabase } = await import('@/lib/supabase/client');
    const { data, error } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id;
    if (!userId) {
      // «Non ho potuto chiedere chi sei» non è «non hai fatto l'accesso». La
      // regola che distingue le due cose è una sola e sta col portiere del
      // sito: qui si chiama, non si riscrive.
      if (erroreDaFornitoreMuto(error)) {
        await avvisa('[carrello] non ho potuto chiedere chi sei: la copia sul server resta indietro');
      }
      return; // senza sapere chi è, non c'è riga da toccare
    }

    if (items.length === 0) {
      if (opzioni.dopoUnOrdine) {
        const marcatura: CampiCarrello = { recovered: true, recovered_at: new Date().toISOString() };
        await scrivi('il carrello di chi ha appena comprato', marcatura, (campi) =>
          supabase.from('abandoned_carts').update(campi).eq('user_id', userId),
        );
        return;
      }
      const { error: erroreCancellazione } = await supabase
        .from('abandoned_carts')
        .delete()
        .eq('user_id', userId);
      if (erroreCancellazione) {
        await avvisa(`[carrello] la riga svuotata a mano non è stata cancellata — ${erroreCancellazione.message}`);
      }
      return;
    }

    const riga: CampiCarrello = {
      user_id: userId,
      cart_data: items,
      cart_total: opzioni.totale,
      last_activity: new Date().toISOString(),
      // Il contenuto è cambiato: questo è un carrello nuovo, non quello per
      // cui abbiamo già scritto una volta.
      recovery_email_sent_at: null,
      recovered: false,
      recovered_at: null,
    };
    await scrivi('il carrello messo da parte', riga, (campi) =>
      supabase.from('abandoned_carts').upsert(campi, { onConflict: 'user_id' }),
    );
  } catch {
    /* best-effort: il recupero carrello non deve mai rompere il carrello locale */
  }
}

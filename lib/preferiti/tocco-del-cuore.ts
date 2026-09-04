import type { QueryClient, UseMutationOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';

/**
 * IL TOCCO SUL CUORE DEI PREFERITI — quello che si vede subito, e quello che si scrive dopo.
 *
 * ── Il difetto che ha prodotto questo file ──────────────────────────────────────────────────
 * Il cuore sulla scheda di catalogo si riempiva alla fine di tre giri di rete: la domanda «chi sei»
 * al servizio di accesso, la riga scritta nel database, e la rilettura dell'intero elenco dei
 * preferiti. Fino ad allora restava grigio. L'unica cosa immediata era l'animazione: un battito su
 * un cuore che non era cambiato. Su una rete lenta chi compra tocca due o tre volte, convinto di
 * aver sbagliato mira — e ogni tocco in più è una riga in più che il database poi rifiuta, perché
 * la coppia (utente, prodotto) è unica.
 *
 * ── La cura, in una frase ───────────────────────────────────────────────────────────────────
 * Il cuore cambia SUBITO, prima di scrivere. Poi si scrive. Se il server rifiuta, quel cuore torna
 * com'era e chi ha toccato riceve il messaggio: non resta un salvataggio che non esiste.
 *
 * ── Perché leggo, decido e ribalto tutto insieme, senza `onMutate` ──────────────────────────
 * Questa è la parte che ho sbagliato al primo giro, e che la prova ha bocciato. Il modo consueto —
 * ribaltare in `onMutate` e decidere la scrittura dopo, leggendo la cache — regge un tocco solo. A
 * due tocchi rapidi i due ribaltamenti finiscono prima delle due scritture, e tutte e due le
 * scritture leggono la stessa cache: partono due «togli» e l'aggiunta non arriva mai al database.
 * Qui leggere-decidere-ribaltare è un blocco unico che nessun altro tocco può spezzare, e ogni
 * scrittura porta con sé il verso deciso nel momento in cui il cuore è cambiato.
 *
 * ── Perché un file a parte e non tre righe dentro l'aggancio ────────────────────────────────
 * Perché così la regola si può ESEGUIRE in una prova, compreso il caso scomodo — il server che dice
 * di no, e il doppio tocco — che dentro un aggancio di React non si riesce a far succedere. Qui non
 * c'è React, non c'è rete e non c'è il database: c'è solo la regola. L'aggancio la usa, non la
 * ricopia.
 *
 * 🟢 Puro: nessuna rete, nessun orologio.
 */

/** La chiave della lista dei preferiti in cache: una sola, la stessa che legge chi disegna i cuori. */
export const CHIAVE_PREFERITI = queryKeys.favorites.all;

/** Cosa deve fare il database perché la riga somigli al cuore che si vede adesso. */
export type Verso = 'aggiungi' | 'togli';

/** Il messaggio quando si tocca un cuore senza avere in mano la lista: non si scrive alla cieca. */
export const PREFERITI_NON_LETTI = 'PREFERITI_NON_LETTI';

/** L'elenco dei preferiti dopo un tocco: dentro se era fuori, fuori se era dentro. */
export function insiemeDopoIlTocco(precedente: ReadonlySet<string>, idProdotto: string): Set<string> {
  const dopo = new Set<string>(precedente);
  if (!dopo.delete(idProdotto)) dopo.add(idProdotto);
  return dopo;
}

/**
 * La scrittura insegue quello che si vede, non quello che si ricordava chi ha disegnato la scheda.
 * Cuore pieno a schermo → la riga deve entrare; cuore vuoto → la riga deve uscire.
 */
export function versoDaScrivere(mostrato: ReadonlySet<string>, idProdotto: string): Verso {
  return mostrato.has(idProdotto) ? 'aggiungi' : 'togli';
}

/**
 * Le regole del tocco, pronte da dare a `useMutation`.
 *
 * `scrivi` è l'unico pezzo che tocca il mondo (accesso e database): sta nell'aggancio, così qui
 * dentro non entra né la rete né Supabase.
 */
export function opzioniDelTocco(
  qc: QueryClient,
  scrivi: (idProdotto: string, verso: Verso) => Promise<void>,
): UseMutationOptions<void, Error, string> {
  return {
    mutationFn: async (idProdotto: string): Promise<void> => {
      // ① Leggere, decidere e ribaltare: un blocco unico, senza attese in mezzo. È qui che il cuore
      //    cambia sotto il dito, prima di qualunque risposta.
      const prima = qc.getQueryData<Set<string>>(CHIAVE_PREFERITI);
      // Senza la lista in mano non si ribalta niente e non si scrive: «non lo so» non deve
      // diventare un sì. Chi disegna il cuore distingue i tre stati guardando se questa casella è
      // ancora vuota, e riempirla a caso gliene toglierebbe uno.
      if (prima === undefined) throw new Error(PREFERITI_NON_LETTI);
      // Una lettura già partita tornerebbe con l'elenco vecchio e cancellerebbe il cambio a video.
      // Non si aspetta: fermarla è immediato, aspettarla ritarderebbe il cuore.
      void qc.cancelQueries({ queryKey: CHIAVE_PREFERITI });
      const dopo = insiemeDopoIlTocco(prima, idProdotto);
      qc.setQueryData(CHIAVE_PREFERITI, dopo);
      const verso = versoDaScrivere(dopo, idProdotto);

      try {
        // ② Solo adesso si va in rete, con il verso deciso nell'istante del ribaltamento.
        await scrivi(idProdotto, verso);
      } catch (errore) {
        // ③ Il server ha rifiutato: torna indietro QUESTO cuore, non tutta la lista. Rimettere la
        //    fotografia di prima cancellerebbe i cuori toccati nel frattempo su altre schede.
        const corrente = qc.getQueryData<Set<string>>(CHIAVE_PREFERITI) ?? dopo;
        qc.setQueryData(CHIAVE_PREFERITI, insiemeDopoIlTocco(corrente, idProdotto));
        throw errore;
      } finally {
        // ④ In ogni caso si rilegge l'elenco vero: se due tocchi si sono accavallati, qui la lista
        //    torna quella del database.
        void qc.invalidateQueries({ queryKey: CHIAVE_PREFERITI });
      }
    },
  };
}

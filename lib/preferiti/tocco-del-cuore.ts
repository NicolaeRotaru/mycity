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
 * ── 13/11/2026 (R15-013) — Una fila per prodotto ───────────────────────────────────────────
 * Tre tocchi veloci partivano come tre scritture in parallelo. Con la rete che ne consegna una in
 * ritardo l'ordine si invertiva: «aggiungi», poi l'«aggiungi» del terzo tocco che trova la riga
 * ancora lì (doppione, 409), e solo dopo il «togli» del secondo. Il 409 ribaltava il cuore e il
 * «togli» in ritardo cancellava la riga: cuore vuoto e nessun preferito, con l'ultimo tocco
 * «aggiungi». Adesso le scritture sullo stesso prodotto partono in fila, una dopo l'altra, quindi
 * l'ultima ad arrivare è quella dell'ultimo tocco. E un rifiuto ribalta il cuore solo se viene
 * dall'ultimo tocco: se dopo ce n'è un altro, a schermo c'è già quello che il cliente ha scelto, e
 * lo scrive la scrittura che segue. La rilettura dell'elenco aspetta che la fila sia vuota, perché
 * una lettura a metà fila riporterebbe a schermo uno stato di passaggio.
 *
 * ── 17/11/2026 (R03-012) — Due rifiuti in fila, e la richiesta che non risponde ─────────────
 * Due tocchi, tutte e due le scritture rifiutate: il primo rifiuto non ribaltava (non era l'ultimo
 * tocco), il secondo ribaltava il cuore del secondo tocco, cioè lo riempiva. Cuore pieno e nessun
 * preferito. Adesso la fila ricorda l'ultimo stato CONFERMATO dal server (all'inizio quello della
 * lista in mano, poi quello di ogni scrittura riuscita), e un rifiuto dell'ultimo tocco rimette il
 * cuore lì, invece di ribaltare quello che si vede. E una scrittura che non risponde non tiene più
 * ferma la fila per sempre: dopo `TEMPO_MASSIMO_SCRITTURA_MS` vale come rifiutata, la fila va avanti
 * e il cuore torna allo stato confermato. La rilettura a fila vuota riporta comunque il database.
 * Giro di correzione: la scrittura scaduta non si ferma, e se arriva dopo la rilettura cambia il
 * database sotto il cuore (un «togli» a 12 s: cuore pieno, preferito cancellato). Quando arriva
 * comunque, riuscita o no, si rilegge l'elenco (a fila vuota; se no lo fa la fine della fila).
 *
 * 🟢 Niente rete: l'unico orologio è il tempo massimo di una scrittura.
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

/** Oltre questo tempo una scrittura senza risposta vale come rifiutata: la fila non resta ferma. */
const TEMPO_MASSIMO_SCRITTURA_MS = 10_000;

/**
 * La scrittura, o un rifiuto se il server non risponde entro il tempo massimo. La scrittura scaduta
 * però non si ferma: quando arriva comunque (riuscita o rifiutata) parte `seArrivaTardi`.
 */
function entroIlTempoMassimo(scrittura: Promise<void>, seArrivaTardi: () => void): Promise<void> {
  let sveglia: ReturnType<typeof setTimeout> | undefined;
  const scaduta = new Promise<never>((_, rifiuta) => {
    sveglia = setTimeout(() => {
      rifiuta(new Error('PREFERITO_SENZA_RISPOSTA'));
      scrittura.then(seArrivaTardi, seArrivaTardi);
    }, TEMPO_MASSIMO_SCRITTURA_MS);
  });
  return Promise.race([scrittura, scaduta]).finally(() => clearTimeout(sveglia));
}

/**
 * Le file delle scritture, una per prodotto. Stanno fuori da `opzioniDelTocco` perché l'aggancio le
 * ricrea a ogni disegno, e ogni scheda ha il suo aggancio: la fila deve essere una sola per tutta
 * la cache. `ultimo` è il numero dell'ultimo tocco sul prodotto, `coda` la fine della fila,
 * `confermato` l'ultimo stato del prodotto che il server ha confermato (pieno = fra i preferiti).
 */
type Fila = { coda: Promise<void>; ultimo: number; confermato: boolean };
const FILE_DEI_TOCCHI = new WeakMap<QueryClient, Map<string, Fila>>();

function filaDelProdotto(qc: QueryClient, idProdotto: string, confermato: boolean): Fila {
  let file = FILE_DEI_TOCCHI.get(qc);
  if (!file) {
    file = new Map();
    FILE_DEI_TOCCHI.set(qc, file);
  }
  let fila = file.get(idProdotto);
  if (!fila) {
    fila = { coda: Promise.resolve(), ultimo: 0, confermato };
    file.set(idProdotto, fila);
  }
  return fila;
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

      // Il posto in fila si prende nello stesso blocco: l'ordine delle scritture è quello dei tocchi.
      const fila = filaDelProdotto(qc, idProdotto, prima.has(idProdotto));
      const numero = ++fila.ultimo;
      const scrittura = fila.coda
        .then(() =>
          entroIlTempoMassimo(scrivi(idProdotto, verso), () => {
            // La scrittura scaduta è arrivata lo stesso, magari dopo la rilettura: il database può
            // essere cambiato sotto il cuore. A fila vuota si rilegge; con altri tocchi in fila lo fa
            // la loro fine, che arriva dopo (a metà fila tornerebbe uno stato di passaggio).
            if (!FILE_DEI_TOCCHI.get(qc)?.has(idProdotto)) void qc.invalidateQueries({ queryKey: CHIAVE_PREFERITI });
          }),
        )
        .then(() => {
          fila.confermato = verso === 'aggiungi';
        });
      fila.coda = scrittura.then(
        () => undefined,
        () => undefined,
      );

      try {
        // ② Si va in rete con il verso deciso nell'istante del ribaltamento, e solo quando la
        //    scrittura del tocco prima, sullo stesso prodotto, ha avuto la sua risposta.
        await scrittura;
      } catch (errore) {
        // ③ Il server ha rifiutato (o non ha risposto in tempo): QUESTO cuore torna all'ultimo stato
        //    confermato, non tutta la lista. Rimettere la fotografia di prima cancellerebbe i cuori
        //    toccati nel frattempo su altre schede. Solo se è l'ultimo tocco: se ne è arrivato un
        //    altro, il cuore a schermo è già quello scelto dopo, e la sua scrittura è in fila.
        if (numero === fila.ultimo) {
          const corrente = qc.getQueryData<Set<string>>(CHIAVE_PREFERITI) ?? dopo;
          if (corrente.has(idProdotto) !== fila.confermato) {
            qc.setQueryData(CHIAVE_PREFERITI, insiemeDopoIlTocco(corrente, idProdotto));
          }
        }
        throw errore;
      } finally {
        // ④ Finita la fila si rilegge l'elenco vero: se qualcosa si è accavallato, qui la lista
        //    torna quella del database. A metà fila no: tornerebbe uno stato di passaggio.
        if (numero === fila.ultimo) {
          FILE_DEI_TOCCHI.get(qc)?.delete(idProdotto);
          void qc.invalidateQueries({ queryKey: CHIAVE_PREFERITI });
        }
      }
    },
  };
}

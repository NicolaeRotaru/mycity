import { after } from 'next/server';
import { chiaveDellaFila } from '@/lib/api/fila-per-richiesta';
import { logger } from '@/lib/logger';

/**
 * IL LAVORO CHE NON DEVE FAR ASPETTARE, MA NEMMENO SPARIRE.
 *
 * Radiografia del 27/8/2026, terzo bloccante. Le comunicazioni dopo un ordine —
 * email al cliente, email al negozio, campanella — partivano come promesse non
 * attese: `const avvisi = (async () => { ... })()` seguito da `void
 * avvisi.catch(...)`. Nessuno le aspettava, ed è giusto: Stripe considera
 * fallita una consegna che non riceve risposta entro pochi secondi.
 *
 * Ma su una piattaforma serverless — la nostra è Vercel — la funzione può
 * essere spenta appena ha risposto. Il lavoro lanciato «per conto suo» non è
 * garantito: può morire a metà, o non partire affatto. Sul percorso dei soldi
 * vuol dire ordine pagato e nessuno avvisato.
 *
 * `after()` di Next 15 è esattamente il pezzo che mancava: la risposta parte
 * subito, e la piattaforma tiene viva l'esecuzione finché il lavoro registrato
 * non è finito. Il grep del 27/8 su tutto `app/` e `lib/` contava zero usi di
 * `after` e zero di `waitUntil`.
 *
 * IL RIPIEGO. `after()` vive dentro una richiesta: chiamato fuori (uno script,
 * un lavoro periodico avviato a mano, una prova) lancia. Qui si ripiega sul
 * comportamento di prima — che fuori da un server serverless funziona — invece
 * di far fallire un ordine già pagato.
 *
 * R05-003 — IN FILA, NON TUTTE INSIEME. Dopo la risposta Next fa partire insieme tutti i lavori
 * registrati con `after()`, senza tetto. Con tante email nello stesso giro (gli ordini scaduti:
 * negozio, cliente, rimborso per ogni ordine) il limite d'invio della posta ne respingeva alcune, e
 * il ritentativo unico del client della posta, dopo 300 ms, ripartiva per tutte nello stesso istante.
 * Ora ogni lavoro aspetta che il precedente sia finito (`nellaFila`). Un lavoro appeso non ferma la
 * fila per sempre: `TETTO_DEL_TURNO_MS` dopo che è PARTITO parte il successivo, e l'appeso continua
 * per conto suo. Il tetto conta dall'inizio del lavoro, non da quando è entrato in fila: contato
 * dall'ingresso, in una raffica scadeva per tutti insieme, e a 10 s partivano tutti quelli rimasti.
 *
 * R09-008 — UNA FILA PER RICHIESTA, NON UNA PER TUTTO IL SERVER. La fila era una variabile del modulo:
 * con più richieste servite dallo stesso processo (Fluid compute) le email di una raffica di ordini
 * si mettevano in coda dietro quelle delle altre, e la richiesta con gli ultimi lavori poteva arrivare
 * al suo tetto di durata prima del suo turno. Ora ogni richiesta ha la sua fila.
 *
 * 28/11/2026 (R09-006) — LA CHIAVE DELLA FILA NON VIENE PIÙ DA UN FILE INTERNO DI NEXT. Era lo stato
 * della richiesta di Next (`next/dist/server/app-render/work-async-storage.external`), che Next può
 * spostare a ogni versione. Ora la apre `conFilaPerRichiesta` (lib/api/fila-per-richiesta.ts), che
 * avvolge il gestore della rotta con un `AsyncLocalStorage` di Node; fuori da una richiesta avvolta
 * (script, prove) resta una fila sola.
 */
const TETTO_DEL_TURNO_MS = 10_000;
const SENZA_RICHIESTA = {};
const file = new WeakMap<object, Promise<void>>();

/** La chiave della fila: quella della richiesta avvolta in corso, o una chiave unica fuori da una richiesta. */
function chiaveDellaRichiesta(): object {
  return chiaveDellaFila() ?? SENZA_RICHIESTA;
}

/**
 * Mette il lavoro in fila: parte quando il precedente è finito (o dopo il tetto del suo turno).
 * Esportata per chi registra da sé il suo `after()`: `after(() => nellaFila(lavoro))`. La chiave di
 * default si legge anche dentro il callback di `after()`, perché Next lo lega al contesto della
 * richiesta in cui è stato registrato (e la chiave nasce all'ingresso, con `conFilaPerRichiesta`).
 */
export function nellaFila(
  lavoro: () => Promise<void>,
  chiave: object = chiaveDellaRichiesta(),
): Promise<void> {
  const prima = file.get(chiave) ?? Promise.resolve();
  const turno = prima.then(lavoro);
  // Il turno si libera quando il lavoro finisce (bene o male) o, se è appeso, a 10 s dal suo inizio:
  // la sveglia parte nello stesso momento del lavoro, quando il precedente ha liberato il turno.
  file.set(
    chiave,
    prima.then(
      () =>
        new Promise<void>((libera) => {
          const sveglia = setTimeout(libera, TETTO_DEL_TURNO_MS);
          (sveglia as { unref?: () => void }).unref?.();
          const fine = () => {
            clearTimeout(sveglia);
            libera();
          };
          turno.then(fine, fine);
        }),
    ),
  );
  return turno;
}

export function dopoLaRisposta(lavoro: () => Promise<void>, cosa: string): void {
  const conRete = () =>
    lavoro().catch((e) =>
      logger.warn(`[dopo-la-risposta] ${cosa} non completato`, {
        message: e instanceof Error ? e.message : 'errore',
      }),
    );

  // La chiave si prende qui, dentro la richiesta: il callback di after() può girare fuori dal suo contesto.
  const chiave = chiaveDellaRichiesta();
  try {
    after(() => nellaFila(conRete, chiave));
  } catch {
    // Nessun contesto di richiesta: si fa partire lo stesso, senza attendere.
    void conRete();
  }
}

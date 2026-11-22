import { after } from 'next/server';
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
 */
const TETTO_DEL_TURNO_MS = 10_000;
let ultimoTurno: Promise<void> = Promise.resolve();

/**
 * Mette il lavoro in fila: parte quando il precedente è finito (o dopo il tetto del suo turno).
 * Esportata per chi registra da sé il suo `after()` (lib/ordini/annulla.ts): `after(() => nellaFila(lavoro))`.
 */
export function nellaFila(lavoro: () => Promise<void>): Promise<void> {
  const prima = ultimoTurno;
  const turno = prima.then(lavoro);
  // Il turno si libera quando il lavoro finisce (bene o male) o, se è appeso, a 10 s dal suo inizio:
  // la sveglia parte nello stesso momento del lavoro, quando il precedente ha liberato il turno.
  ultimoTurno = prima.then(
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

  try {
    after(() => nellaFila(conRete));
  } catch {
    // Nessun contesto di richiesta: si fa partire lo stesso, senza attendere.
    void conRete();
  }
}

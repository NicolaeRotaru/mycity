import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 28/11/2026 (R09-006) — LA CHIAVE DELLA FILA «UNA PER RICHIESTA», CON UN'API PUBBLICA DI NODE.
 *
 * I lavori dopo la risposta (lib/api/dopo-la-risposta.ts) stanno in fila, una fila per richiesta
 * (R05-003, R09-008). La chiave della fila era lo stato della richiesta di Next, letto da
 * `next/dist/server/app-render/work-async-storage.external`: un file interno che Next può spostare
 * o cambiare a ogni versione. Un aggiornamento di Next avrebbe rotto la compilazione o, peggio,
 * rimesso tutte le richieste in una fila sola senza che nessuno se ne accorgesse.
 *
 * Ora la chiave nasce qui: `conFilaPerRichiesta` avvolge il gestore della rotta e apre un
 * `AsyncLocalStorage` di Node per la durata della richiesta. Nata all'ingresso, la chiave la vedono
 * tutti i rami del lavoro della richiesta (cicli, `Promise.all`, aiutanti annidati) e anche i
 * callback di `after()`, che Next lega al contesto in cui sono stati registrati. Non si usa
 * `enterWith` alla prima chiamata: aperta dentro un ramo, la chiave non torna al chiamante, e il
 * giro degli ordini scaduti avrebbe aperto una fila per ordine, cioè tutte le email insieme.
 *
 * Fuori da una richiesta avvolta (script, prove, una rotta nuova dimenticata) `chiaveDellaFila`
 * torna `null` e chi chiama usa una fila sola: più lenta, mai persa. La prova
 * tests/unit/riparazione-onda2-r09-006-fila-senza-file-interni-di-next.test.ts controlla che ogni
 * rotta che arriva a lib/api/dopo-la-risposta.ts sia avvolta.
 *
 * Sta in un file suo, separato da dopo-la-risposta.ts, perché molte prove sostituiscono quel modulo
 * con un finto: le rotte avvolte devono continuare a funzionare anche lì.
 */
const filaDellaRichiesta = new AsyncLocalStorage<object>();

/**
 * Avvolge il gestore di una rotta: dentro, i lavori dopo la risposta usano la fila di QUESTA
 * richiesta. Una rotta chiamata da un'altra rotta (app/api/chat/conversations → messages) resta
 * nella fila di chi l'ha chiamata: una richiesta, una fila.
 *
 * Il tipo resta quello del gestore, intero: gli involucri di lib/api/middleware.ts danno alla rotta
 * due firme (con e senza il contesto di Next, `RottaDiNext`), e un generico sugli argomenti ne
 * teneva solo l'ultima, quella senza contesto.
 */
export function conFilaPerRichiesta<F extends (...argomenti: never[]) => unknown>(gestore: F): F {
  const chiama = gestore as unknown as (...argomenti: unknown[]) => unknown;
  const avvolto = (...argomenti: unknown[]) =>
    filaDellaRichiesta.getStore() ? chiama(...argomenti) : filaDellaRichiesta.run({}, () => chiama(...argomenti));
  return avvolto as unknown as F;
}

/** La chiave della richiesta avvolta in corso, o `null` fuori da una richiesta avvolta. */
export function chiaveDellaFila(): object | null {
  return filaDellaRichiesta.getStore() ?? null;
}

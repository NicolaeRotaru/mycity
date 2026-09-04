/**
 * #236 — Il registratore degli errori si accende PRIMA del primo disegno.
 *
 * Next esegue questo file all'avvio del browser, prima che React monti
 * qualunque cosa. Fino a ieri l'accensione stava dentro un componente
 * (`SentryProvider`), quindi un errore che rompe l'applicazione mentre si
 * carica — il guasto peggiore, quello che lascia la pagina bianca — non veniva
 * registrato da nessuno: la registrazione partiva dopo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 3/9/2026 — «NON COSTA NIENTE» ERA FALSO: COSTAVA A TUTTE E 245 LE PAGINE.
 *
 * Qui sotto c'era `import * as Sentry from '@sentry/nextjs'`, e in fondo
 * `export const onRouterTransitionStart = Sentry.captureRouterTransitionStart`.
 * Sono due modi diversi di dire la stessa cosa a chi costruisce il pacchetto:
 * «questo codice mi serve subito». Un `import` in cima al file entra nel
 * pacchetto SEMPRE — la condizione `if (SENTRY_DSN)` qui sotto decide se
 * *eseguirlo*, non se *spedirlo*.
 *
 * Risultato misurato sul build presente nella cartella: il pezzo con dentro
 * l'SDK del browser di Sentry compariva in tutte e 245 le voci del manifesto,
 * `/layout` compreso. Lo scaricava anche chi apriva solo la home o la cassa. E
 * nel repo il DSN non c'e' (c'e' solo `.env.example`): codice inerte, spedito a
 * tutti, su una rete di telefono.
 *
 * La cura e' chiedere l'SDK solo quando serve davvero: `import('@sentry/nextjs')`
 * dentro l'`if`. Cosi' il costruttore del pacchetto lo mette in un file a
 * parte, che si scarica soltanto se il DSN c'e'.
 *
 * `import type` invece resta: i tipi spariscono in fase di compilazione e non
 * finiscono in nessun pacchetto.
 *
 * ⚠️ IL PREZZO DI QUESTA SCELTA, DETTO CHIARO. Con l'import in cima, `init`
 * partiva nello stesso istante dello script. Adesso parte quando il pezzo
 * separato arriva: qualche decina di millisecondi dopo. Un errore che rompe la
 * pagina in quella finestra non lo registra nessuno — cioe' proprio il caso per
 * cui #236 aveva spostato l'accensione qui.
 *
 * Oggi lo scambio conviene senza discussione: il DSN non e' configurato, quindi
 * quel pacchetto e' peso puro per tutti e non registra un bel niente. Il giorno
 * in cui il DSN si accende, la finestra va richiusa — due ascoltatori nativi
 * (`error`, `unhandledrejection`) messi qui in modo sincrono, che tengono da
 * parte quello che succede e lo consegnano a Sentry appena arriva. Non l'ho
 * fatto adesso perche' questo e' il primo file che gira su ogni pagina: uno
 * sbaglio qui e' una pagina bianca, e non si mette codice in piu' in cambio di
 * niente.
 */

import type * as Sentry from '@sentry/nextjs';
import { opzioniSentry, SENTRY_DSN } from '@/lib/analytics/sentry-config';

type AvvioNavigazione = typeof Sentry.captureRouterTransitionStart;

/** La funzione vera, quando l'SDK e' arrivato. Prima e' `undefined`. */
let avvioNavigazione: AvvioNavigazione | undefined;

/**
 * Le navigazioni successe mentre l'SDK stava ancora arrivando.
 *
 * Senza questa coda il caricamento a pacchetto separato perderebbe proprio la
 * prima navigazione — cioe' i primi istanti, che sono quelli per cui #236 ha
 * spostato l'accensione qui. Il tetto e' basso apposta: se l'SDK non arriva
 * (rete, blocco pubblicita'), non si tiene in memoria una coda che cresce.
 */
const inAttesa: Parameters<AvvioNavigazione>[] = [];
const MAX_IN_ATTESA = 20;

if (SENTRY_DSN) {
  void import('@sentry/nextjs').then((S) => {
    S.init(opzioniSentry() as Parameters<typeof S.init>[0]);
    avvioNavigazione = S.captureRouterTransitionStart;
    for (const argomenti of inAttesa.splice(0)) avvioNavigazione(...argomenti);
  });
}

/**
 * Il gancio che Next chiama a ogni cambio di pagina. Deve esistere subito, come
 * nome: prima era il simbolo di Sentry riesportato, ed era il secondo motivo
 * per cui l'SDK finiva nel pacchetto di tutti. Adesso e' una funzione nostra
 * che inoltra a quella vera appena c'e'.
 */
export function onRouterTransitionStart(...argomenti: Parameters<AvvioNavigazione>): void {
  if (avvioNavigazione) {
    avvioNavigazione(...argomenti);
    return;
  }
  if (SENTRY_DSN && inAttesa.length < MAX_IN_ATTESA) inAttesa.push(argomenti);
}

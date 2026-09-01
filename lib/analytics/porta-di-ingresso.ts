/**
 * 27/8/2026 (R160) — DA QUALE PORTA È ENTRATA QUESTA PERSONA, E SE È LA PRIMA
 * VOLTA.
 *
 * Il difetto. Chi si registra con email e password non veniva mai contato come
 * iscritto. A decidere «registrazione o accesso?» era una finestra di sessanta
 * secondi in `/auth/callback`: se l'account era nato da meno di un minuto,
 * allora era nuovo. Ma con email e password l'account nasce quando si compila
 * il modulo, e il link di conferma si apre dopo — si va a prendere il
 * telefono, si cerca la mail, a volte finisce nello spam e si torna il giorno
 * dopo. Oltre il minuto, cioè quasi sempre, usciva «accesso».
 *
 * Risultato: gli iscritti dal canale email risultavano zero, e gli accessi
 * gonfiati di uno per ogni nuovo iscritto. Ogni tasso «iscritto → primo
 * ordine» poggiava su quei due numeri.
 *
 * La riparazione. Non si deduce più «è nuovo» dal tempo: l'intenzione viaggia
 * DENTRO il link di conferma, che è l'unico posto dove la si conosce per
 * certo — chi arriva da quel link si stava registrando, punto. Il segnale sta
 * nel percorso di ritorno (`next`), non fra i parametri che la rotta di
 * callback riscrive: così sopravvive anche al giro da /accetta-condizioni, che
 * `auth` e `via` invece li perde per strada.
 *
 * Il doppio conteggio resta impossibile: `trackSignupCompleted` porta un
 * `$insert_id` legato all'id della persona, e chi ricarica la pagina non conta
 * una seconda volta.
 */

import { safeInternalPath } from '@/lib/safe-redirect';

/** Il parametro che dice «questa è una registrazione», e da quale porta. */
export const PARAM_REGISTRAZIONE = 'registrazione';

/** Quello che va tolto dall'indirizzo dopo aver emesso l'evento. */
export const PARAMETRI_DA_RIPULIRE = ['auth', 'via', PARAM_REGISTRAZIONE] as const;

export type EventoDiAccesso = { tipo: 'signup' | 'signin'; canale: string };

/** Quando il canale non si sa, o non è un canale. */
export const CANALE_SCONOSCIUTO = 'sconosciuto';

/**
 * `via` e il marcatore stanno in un indirizzo, e un indirizzo lo scrive
 * chiunque: senza questo controllo bastava mandare in giro un link per
 * riempire di testo arbitrario il grafico dei canali d'ingresso.
 */
function canaleValido(grezzo: string | null | undefined): string {
  const pulito = (grezzo ?? '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,20}$/.test(pulito) ? pulito : CANALE_SCONOSCIUTO;
}

/**
 * L'indirizzo a cui torna chi ha appena chiesto di registrarsi, con dentro
 * l'intenzione. `returnTo` è dove la persona stava andando prima di iscriversi
 * (il checkout, di solito): resta, perché altrimenti riatterra sulla home con
 * il carrello pieno e l'ordine da rifare.
 */
export function ritornoDopoLaConferma(
  base: string,
  returnTo?: string | null,
  canale = 'email',
): string {
  const interno = safeInternalPath(returnTo || '/', '/');
  // Base finta: serve solo per attaccare un parametro a un percorso relativo.
  const dove = new URL(interno, 'http://percorso.interno');
  dove.searchParams.set(PARAM_REGISTRAZIONE, canaleValido(canale));
  const next = `${dove.pathname}${dove.search}${dove.hash}`;
  return `${base}/auth/callback?next=${encodeURIComponent(next)}`;
}

/**
 * Che evento emettere per chi è appena atterrato, guardando l'indirizzo.
 * `null` = non è un arrivo da un accesso, e non si emette niente.
 */
export function decidiEventoDiAccesso(
  params: { get(nome: string): string | null },
): EventoDiAccesso | null {
  const marcatore = params.get(PARAM_REGISTRAZIONE);
  const via = params.get('via');
  const auth = params.get('auth');

  // Il marcatore vince sulla finestra dei sessanta secondi: lo ha messo la
  // pagina di registrazione, che sa per certo di cosa si tratta.
  if (marcatore) return { tipo: 'signup', canale: canaleValido(via ?? marcatore) };
  if (auth === 'signup') return { tipo: 'signup', canale: canaleValido(via) };
  if (auth === 'signin') return { tipo: 'signin', canale: canaleValido(via) };
  return null;
}

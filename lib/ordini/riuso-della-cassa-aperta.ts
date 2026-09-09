import {
  MOTIVO_CARTA_ANCORA_APERTA,
  type RiserveLiberate,
} from '@/lib/ordini/ordine-in-contanti-puo-nascere';

/**
 * RESTITUIRE LA CASSA GIÀ APERTA È UN INCASSO: PASSA DALLO STESSO CANCELLO.
 *
 * ── Il difetto che ha prodotto questo file (8/9/2026) ───────────────────────
 * La rotta della carta fa due cose, in quest'ordine: prima ripulisce i
 * tentativi abbandonati dello stesso cliente sugli stessi prodotti
 * (`liberaRiserveAbbandonate`), poi — se lo stesso identico carrello ha già un
 * pagamento aperto — restituisce QUELLA pagina invece di aprirne una seconda.
 *
 * Il cancello che deve fermare tutto quando una pagina vecchia è rimasta
 * pagabile (`ancoraPagabili`) stava duecento righe più in basso, dentro la
 * rivendicazione del codice sconto. Il ramo del riuso usciva prima, con un
 * `return` suo, e quel cancello non lo guardava nessuno.
 *
 * Cosa vedeva la persona. Maria mette una torta nel carrello e preme «Paga con
 * carta»: si apre la pagina A. Torna indietro, cambia la fascia di consegna e
 * ripaga: nasce la pagina B, e la A avrebbe dovuto morire — ma Stripe non
 * risponde e resta viva. Maria torna sulla fascia di prima e ripreme: il
 * carrello è di nuovo identico a quello della pagina B, quindi la rotta le
 * restituisce la B. Adesso ci sono DUE pagine vive sulla stessa torta, la A e
 * la B, e Maria può pagarle tutte e due. La torta è una.
 *
 * ── La regola ───────────────────────────────────────────────────────────────
 * **Una pagina vecchia rimasta pagabile ferma anche il riuso**, non solo
 * l'apertura di una pagina nuova. Il criterio è identico a quello dei contanti
 * (`ordineInContantiPuoNascere`) e a quello del codice sconto
 * (`laStradaELibera`): basta UNA porta rimasta aperta.
 *
 * Rifiutare non perde l'ordine: la pagina che si sarebbe riusata resta lì,
 * pagabile, e la riserva vecchia non è stata toccata. Maria riprova fra dieci
 * secondi e al secondo giro o la vecchia si chiude davvero o risulta già morta
 * da sé. Trenta secondi persi si recuperano; un addebito doppio scoperto dopo
 * giorni è una telefonata all'assistenza e un cliente che non torna.
 *
 * ── Perché sta qui e non dentro la rotta ────────────────────────────────────
 * Dentro `route.ts` questa decisione conviveva con `next/server` e con Stripe:
 * nessuna prova poteva ESEGUIRLA, si poteva solo cercarla nel sorgente con una
 * ricerca di parole — che non fallisce nel modo in cui fallisce la realtà.
 * Qui è una funzione pura che vuole in ingresso il resoconto della pulizia:
 * chi scrive la rotta non può più restituire una cassa senza averlo guardato,
 * perché senza quel resoconto non gli si compila.
 */

/** Il poco che serve della sessione riletta da Stripe. */
export type SessioneRiletta = {
  id?: string | null;
  status?: string | null;
  url?: string | null;
} | null | undefined;

export type EsitoRiuso =
  /** La pagina di prima è viva e sua: si restituisce quella, nessuna seconda cassa. */
  | { esito: 'riusa'; id: string; url: string }
  /** Niente da riusare (mai aperta, scaduta, Stripe muto): si va avanti normalmente. */
  | { esito: 'apri_nuova' }
  /** Un pagamento vecchio è rimasto pagabile: non si incassa niente, in nessuna forma. */
  | { esito: 'ferma_tutto'; messaggio: string; sessioni: string[] };

/**
 * Decide cosa fare della cassa già aperta sullo stesso carrello, visto com'è
 * andata la pulizia dei tentativi abbandonati dello stesso cliente.
 *
 * @param riserveLiberate  Il resoconto di `liberaRiserveAbbandonate`. È il primo
 *   parametro apposta: è la prova che la pulizia è già passata di qui.
 * @param sessione  La sessione riletta da Stripe, oppure `null` se non è stato
 *   possibile rileggerla. `null` non è un via libera: è solo «non c'è niente da
 *   riusare», e il cancello del primo parametro vale lo stesso.
 */
export function riusoDellaCassaAperta(
  riserveLiberate: RiserveLiberate | null | undefined,
  sessione: SessioneRiletta,
): EsitoRiuso {
  // ① Il cancello viene PRIMA di guardare la sessione: una porta vecchia
  //    rimasta aperta ferma tutto, che ci sia qualcosa da riusare o no.
  const sessioni = [
    ...new Set(
      (riserveLiberate?.ancoraPagabili ?? []).filter(
        (s): s is string => typeof s === 'string' && s.trim() !== '',
      ),
    ),
  ];
  if (sessioni.length > 0) {
    return { esito: 'ferma_tutto', messaggio: MOTIVO_CARTA_ANCORA_APERTA, sessioni };
  }

  // ② Si riusa solo una pagina davvero pagabile: aperta, con il suo indirizzo.
  const id = typeof sessione?.id === 'string' ? sessione.id.trim() : '';
  const url = typeof sessione?.url === 'string' ? sessione.url.trim() : '';
  if (sessione?.status === 'open' && id !== '' && url !== '') {
    return { esito: 'riusa', id, url };
  }

  return { esito: 'apri_nuova' };
}

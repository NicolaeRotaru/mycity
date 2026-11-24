import { SLUG_SERVIZIO, servizioDaSlug, type ServizioAgenzia } from './preventivo';

/**
 * GLI INDIRIZZI DEI SERVIZI NELL'AREA DEL NEGOZIO — 24/11/2026.
 *
 * Nicola, dalla pagina «Foto e video» di Pane Quotidiano: «togli la sezione preventivo, perché
 * ognuna di quelle sezioni è di per sé un preventivo… fai in modo che ci sia poi un bottone che
 * manda alla pagina dove si sceglie quell'abbonamento». Quindi:
 *  · ogni servizio ha la sua pagina, /seller/servizi/<slug>, che è il suo preventivo;
 *  · l'abbonamento si sceglie e si paga in una pagina sola, /seller/abbonamento.
 *
 * I vecchi indirizzi /seller/preventivo… restano vivi nelle email, nelle notifiche e nelle casse
 * Stripe già aperte: il portiere li rimanda ai nuovi (`indirizzoDopoIlPreventivo`), con la stessa
 * domanda dopo il «?» (per esempio ?pagato=1 al ritorno da Stripe).
 *
 * Qui non ci sono icone né React: lo legge anche il portiere, che gira sul bordo.
 */

export const PERCORSO_ABBONAMENTO = '/seller/abbonamento';
export const PERCORSO_SERVIZI = '/seller/servizi';

export const hrefServizio = (id: ServizioAgenzia) => `${PERCORSO_SERVIZI}/${SLUG_SERVIZIO[id]}`;

const VECCHIO_PREVENTIVO = '/seller/preventivo';

/** La vecchia pagina della scheda Google: dal 24/11 è dentro la gestione social. */
const VECCHI_SLUG: Record<string, ServizioAgenzia> = { 'scheda-google': 'social' };

/**
 * Il nuovo indirizzo di un vecchio indirizzo del preventivo, o `null` se `pathname` non lo è.
 *  · /seller/preventivo            → /seller/abbonamento
 *  · /seller/preventivo/<servizio> → /seller/servizi/<servizio> (scheda-google → social)
 *  · /seller/preventivo/<altro>    → /seller/abbonamento (meglio la pagina giusta che un «non trovato»)
 */
export function indirizzoDopoIlPreventivo(pathname: string): string | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (p === VECCHIO_PREVENTIVO) return PERCORSO_ABBONAMENTO;
  if (!p.startsWith(`${VECCHIO_PREVENTIVO}/`)) return null;
  const slug = p.slice(VECCHIO_PREVENTIVO.length + 1);
  const id = servizioDaSlug(slug) ?? VECCHI_SLUG[slug] ?? null;
  return id ? hrefServizio(id) : PERCORSO_ABBONAMENTO;
}

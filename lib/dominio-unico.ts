/**
 * 28/11/2026 — IL SITO HA UN INDIRIZZO SOLO.
 *
 * Il marketplace risponde a due indirizzi: quello vero,
 * `www.mycity-marketplace.com`, e quello che Vercel dà a ogni progetto,
 * `mycity-phi.vercel.app`. Il secondo è rimasto acceso dopo il trasloco da
 * Render, senza rimandare al primo.
 *
 * Perché fa danni, anche se mostra le stesse pagine. Il browser tiene
 * l'accesso, il carrello e le notifiche separati per indirizzo. Chi entra da
 * `mycity-phi.vercel.app` ha un'altra sessione: le email di accesso, i ritorni
 * da Stripe e i link che il sito scrive portano invece su `www`, dove risulta
 * uscito, col carrello vuoto. Nei registri di Supabase delle 24 ore fino al
 * 28/11 alle 14:10, 1.235 chiamate partivano da pagine aperte sull'indirizzo
 * vecchio, contro 5.746 dal dominio: circa una su sei. E 5 accessi con Google
 * su 28 tornavano lì.
 *
 * Cosa fa questo file: se una pagina viene chiesta all'indirizzo vecchio, la
 * risposta è un rimando permanente (308) alla stessa pagina sul dominio vero.
 * Non si toccano:
 *  - le anteprime e gli indirizzi delle singole pubblicazioni
 *    (`mycity-<codice>-….vercel.app`): la prova di fumo del rilascio
 *    controlla proprio quelli, prima che vadano in produzione;
 *  - le richieste che non sono GET o HEAD: una scheda rimasta aperta
 *    sull'indirizzo vecchio deve poter finire di mandare un modulo;
 *  - le rotte `/api/` (il middleware non le vede: vedi `config.matcher`),
 *    cioè webhook di Stripe e lavori periodici di Vercel.
 */

import { env } from './env';

/** Gli indirizzi vecchi che devono portare al dominio vero. */
export const INDIRIZZI_VECCHI: readonly string[] = ['mycity-phi.vercel.app'];

type Richiesta = { method: string; url: string; headers: { get(nome: string): string | null } };

function senzaPorta(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

/**
 * L'indirizzo a cui rimandare, oppure null se la richiesta va lasciata passare.
 */
export function rimandoAlDominioVero(req: Richiesta): string | null {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;

  const arrivo = new URL(req.url);
  const host = senzaPorta(req.headers.get('host') ?? arrivo.host);
  if (!INDIRIZZI_VECCHI.includes(host)) return null;

  let vero: URL;
  try {
    vero = new URL(env.appUrl());
  } catch {
    return null;
  }
  // Mai lasciare l'https, e mai rimandare a un indirizzo di Vercel: né a sé
  // stessi né a una singola pubblicazione. Senza NEXT_PUBLIC_APP_URL il sito
  // ripiega sugli indirizzi di Vercel, e un 308 verso quelli il browser se lo
  // ricorderebbe per sempre.
  if (vero.protocol !== 'https:' || senzaPorta(vero.host).endsWith('.vercel.app')) return null;

  return `${vero.origin}${arrivo.pathname}${arrivo.search}`;
}

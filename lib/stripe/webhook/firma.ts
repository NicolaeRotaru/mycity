/**
 * La firma degli avvisi di Stripe: con quale segreto si controlla, e quali
 * avvisi dei conti dei negozi si accettano.
 *
 * 15/10/2026 (R77) — GLI AVVISI SUI CONTI DEI NEGOZI VENIVANO RESPINTI.
 *
 * Il sito controllava la firma di OGNI avviso con un solo segreto,
 * STRIPE_WEBHOOK_SECRET. Ma due avvisi che il codice sa gestire arrivano dai
 * conti Stripe dei negozi, non dal conto di MyCity: «payout.failed» (la banca
 * del negozio rifiuta il bonifico) e «account.updated» (Stripe abilita o blocca
 * i versamenti del negozio). Stripe li manda solo a un indirizzo registrato per
 * gli «eventi sui conti collegati», e quell'indirizzo ha un segreto suo. Con un
 * segreto solo, quegli avvisi o non arrivavano mai o venivano respinti con 400.
 * Caso vero: Pane Quotidiano cambia banca, il bonifico di 120 € rimbalza, e lui
 * nella pagina Guadagni continua a leggere «versato» senza che nessuno lo sappia.
 *
 * Adesso la firma si prova con il segreto dell'indirizzo principale e, se non
 * torna, con quello dell'indirizzo dei conti collegati
 * (STRIPE_CONNECT_WEBHOOK_SECRET). Il sito risponde «non configurato» solo se
 * mancano tutti e due.
 *
 * LA SECONDA PORTA FA PASSARE SOLO QUELLO CHE LE SPETTA. Un avviso che viene
 * da un conto di un negozio porta il campo `account`. Da quella strada si
 * lavorano soltanto gli avvisi che riguardano il conto del negozio; un
 * «pagamento completato» o un «rimborso» arrivati da lì non si lavorano mai:
 * i pagamenti di MyCity passano dal conto di MyCity, e un buono regalo o un
 * ordine non devono poter nascere da un conto che non è il nostro.
 */
import type Stripe from 'stripe';
import { env } from '@/lib/env';

/** Il segreto da provare e da quale indirizzo di Stripe viene. */
export type SegretoWebhook = { indirizzo: 'principale' | 'conti-collegati'; valore: string };

/** Gli avvisi che il sito lavora quando arrivano dal conto di un negozio. */
export const EVENTI_DEI_CONTI_COLLEGATI: ReadonlySet<string> = new Set(['account.updated', 'payout.failed']);

/** I segreti configurati, nell'ordine in cui si provano. Vuoto = webhook non configurato. */
export function segretiDelWebhook(): SegretoWebhook[] {
  const segreti: SegretoWebhook[] = [];
  const principale = env.stripeWebhookSecret();
  const contiCollegati = env.stripeConnectWebhookSecret();
  if (principale) segreti.push({ indirizzo: 'principale', valore: principale });
  if (contiCollegati && contiCollegati !== principale) {
    segreti.push({ indirizzo: 'conti-collegati', valore: contiCollegati });
  }
  return segreti;
}

export type EsitoFirma =
  /** Firma buona e avviso da lavorare. */
  | { esito: 'valida'; evento: Stripe.Event; indirizzo: SegretoWebhook['indirizzo'] }
  /** Firma buona, ma è un avviso di un conto di negozio che qui non si lavora. */
  | { esito: 'fuori-posto'; evento: Stripe.Event; indirizzo: SegretoWebhook['indirizzo'] }
  /** Nessun segreto ha riconosciuto la firma. */
  | { esito: 'non-valida'; errore: unknown };

/**
 * Prova la firma con ogni segreto, nell'ordine. `costruisci` è la verifica di
 * Stripe (`stripe.webhooks.constructEvent`): lancia se la firma non torna.
 */
export function verificaFirma(
  corpo: string,
  firma: string,
  segreti: SegretoWebhook[],
  costruisci: (corpo: string, firma: string, segreto: string) => Stripe.Event,
): EsitoFirma {
  let ultimoErrore: unknown = new Error('nessun segreto del webhook configurato');
  for (const segreto of segreti) {
    let evento: Stripe.Event;
    try {
      evento = costruisci(corpo, firma, segreto.valore);
    } catch (errore) {
      ultimoErrore = errore;
      continue;
    }
    const daUnConto = typeof evento.account === 'string' && evento.account.length > 0;
    if (daUnConto && !EVENTI_DEI_CONTI_COLLEGATI.has(evento.type)) {
      return { esito: 'fuori-posto', evento, indirizzo: segreto.indirizzo };
    }
    return { esito: 'valida', evento, indirizzo: segreto.indirizzo };
  }
  return { esito: 'non-valida', errore: ultimoErrore };
}

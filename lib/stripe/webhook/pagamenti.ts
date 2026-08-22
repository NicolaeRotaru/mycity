/**
 * Esito dei tentativi di pagamento: quali riescono, quali no e perché.
 *
 * #12 — Perché sta qui e non in `app/api/stripe/webhook/route.ts`.
 *
 * Quel file era uno solo, da mille righe, con dentro otto mestieri senza
 * rapporto fra loro: creazione ordini, buoni regalo, spazi sponsorizzati,
 * abbonamenti, rimborsi, contestazioni, storni, esiti dei pagamenti. Ogni
 * modifica ai buoni regalo si portava dietro il rischio di toccare la
 * creazione degli ordini, perché stavano nello stesso file e la revisione
 * mostrava un diff dentro un blocco da mille righe. È la strada su cui
 * passano tutti i soldi del marketplace: è l'ultimo posto dove si vuole una
 * revisione difficile da leggere.
 *
 * Nessuna logica è cambiata in questo spostamento: le prove esistenti sul
 * webhook sono la dimostrazione che non si è rotto niente.
 */
import type Stripe from 'stripe';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { getStripe } from '@/lib/stripe/client';
import { notifyAdmins } from './comune';

/** payment_intent.payment_failed → pagamento non riuscito: log (l'ordine non viene creato). */
export async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent, eventId?: string) {
  logger.warn('[stripe] payment_intent.payment_failed', {
    paymentIntent: pi.id,
    lastError: pi.last_payment_error?.message ?? null,
  });
  await registraTentativoPagamento(pi, 'failed', eventId);
}

export async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent, eventId?: string) {
  await registraTentativoPagamento(pi, 'succeeded', eventId);
}

/**
 * 22/8/2026 — LA CHARGE NON ARRIVA MAI ESPANSA, QUINDI IL 3D SECURE ERA SEMPRE VUOTO.
 *
 * `pi.latest_charge` in un webhook è un identificativo, non un oggetto: Stripe
 * espande solo quello che qualcuno ha chiesto, e qui non lo chiedeva nessuno.
 * Il codice se ne accorgeva («quando non c'è restano vuoti») e scriveva NULL —
 * con la conseguenza che `three_d_secure` e `network_status` non sono MAI stati
 * valorizzati, su nessuna riga.
 *
 * Sono le due colonne che servono a capire perché una carta viene rifiutata:
 * senza, la tabella dice che il pagamento è fallito ma non dice di chi è la
 * colpa — nostra, della banca, o del cliente che non ha completato la verifica.
 *
 * Qui la charge si chiede davvero. Resta best-effort: se la chiamata a Stripe
 * fallisce si scrive lo stesso quello che si ha, perché un webhook che va in
 * errore viene ritentato e ritentato.
 */
async function conLaChargeEspansa(pi: Stripe.PaymentIntent): Promise<Stripe.PaymentIntent> {
  if (typeof pi.latest_charge === 'object' && pi.latest_charge !== null) return pi;
  if (!pi.latest_charge) return pi;
  try {
    return await getStripe().paymentIntents.retrieve(pi.id, { expand: ['latest_charge'] });
  } catch (e) {
    logger.warn('[stripe] charge non recuperata: 3D Secure e esito di rete restano vuoti', {
      paymentIntent: pi.id,
      e,
    });
    return pi;
  }
}

/**
 * 066 — L'ESITO DI OGNI TENTATIVO DI PAGAMENTO, SCRITTO DOVE SI PUO' CONTARE.
 *
 * Del rifiuto di una carta restava una riga di log e nient'altro: il motivo —
 * fondi insufficienti, rifiuto dell'emittente, 3D Secure non completato —
 * finiva su Sentry e spariva. Cosi' alla domanda base del prodotto pagamenti,
 * «quanti tentativi vanno a buon fine e perche' falliscono gli altri», non si
 * poteva rispondere: ogni intervento sul checkout era una scommessa, e
 * un'interruzione dei pagamenti si sarebbe vista solo dal calo degli ordini.
 *
 * Best-effort: una misura non deve mai far fallire un pagamento.
 */
export async function registraTentativoPagamento(
  pi: Stripe.PaymentIntent,
  esito: 'succeeded' | 'failed',
  eventId?: string,
): Promise<void> {
  try {
    const admin = getAdminSupabase();
    const pieno = await conLaChargeEspansa(pi);
    const errore = pieno.last_payment_error;
    const pendingId = typeof pi.metadata?.pending_checkout_id === 'string'
      ? pi.metadata.pending_checkout_id
      : null;
    // La charge arriva espansa solo se qualcuno l'ha chiesto: quando c'e' si
    // legge l'esito di rete e quello del 3D Secure, quando non c'e' restano
    // vuoti. Meglio un campo vuoto che un campo riempito con la cosa sbagliata.
    const charge = typeof pieno.latest_charge === 'object' && pieno.latest_charge !== null
      ? (pieno.latest_charge as Stripe.Charge)
      : null;
    const { error } = await admin.from('payment_attempts').insert({
      // 22/8/2026 — la deduplicazione passa dall'EVENTO, non dal pagamento:
      // lo stesso pagamento può avere più rifiuti diversi, e contarne uno solo
      // falsava il tasso di autorizzazione verso l'alto.
      stripe_event_id: eventId ?? null,
      payment_intent_id: pi.id,
      pending_checkout_id: pendingId,
      user_id: typeof pi.metadata?.buyer_user_id === 'string' ? pi.metadata.buyer_user_id : null,
      amount_cents: pi.amount ?? null,
      status: esito,
      decline_code: errore?.decline_code ?? charge?.outcome?.reason ?? null,
      error_code: errore?.code ?? null,
      network_status: charge?.outcome?.network_status ?? null,
      three_d_secure: charge?.payment_method_details?.card?.three_d_secure?.result ?? null,
    });
    // 23505 = lo stesso evento e' gia' stato registrato: e' idempotenza, non un guasto.
    if (error && (error as { code?: string }).code !== '23505') {
      logger.warn('[stripe] tentativo di pagamento non registrato', { paymentIntent: pi.id, message: error.message });
    }
  } catch (e) {
    logger.warn('[stripe] tentativo di pagamento non registrato', { paymentIntent: pi.id, e });
  }
}

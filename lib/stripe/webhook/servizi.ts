/**
 * GLI ABBONAMENTI DEI SERVIZI — 24/11/2026.
 *
 * Nicola: «sono servizi che offre mycity, ma tramite SDG». Il negozio sceglie Base, Business o
 * Premium dalla pagina «Abbonamento» e paga con Stripe (`app/api/seller/preventivo/paga`).
 * Qui arrivano gli avvisi di quell'abbonamento, riconosciuto da `metadata.kind =
 * servizi_subscription`, e si scrivono SOLO nella tabella `abbonamenti_servizi`: mai sul
 * profilo, dove vive l'abbonamento della vetrina. Le due cose hanno prezzi e storie diverse.
 *
 * Lo stato si rilegge da Stripe ogni volta (`statoDaStripe`): un avviso vecchio arrivato dopo
 * uno nuovo non rimette «attivo» un abbonamento disdetto.
 */
import { PERCORSO_ABBONAMENTO } from '@/lib/agenzia/indirizzi-servizi';
import type Stripe from 'stripe';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { formatPriceFromCents } from '@/lib/format';
import { ABBONAMENTI, FASCE, canonePrimoMese, type Abbonamento } from '@/lib/agenzia/preventivo';
import { notifyAdmins } from './comune';
import { scritturaFacoltativa, scritturaObbligatoria } from './esito';
import { handleSellerSubscription, statoDaStripe } from './abbonamenti';
import { KIND_SERVIZI, KIND_VETRINA } from './tipi-abbonamento';
import { alPrimoAbbonamentoPagato } from '@/lib/agenzia/abbonamento-attivo-n8n';
import { schedaEPagellaAperte } from '@/lib/agenzia/scheda-dopo-abbonamento';

export { KIND_SERVIZI };

const idDi = (x: string | { id?: string } | null | undefined): string | null =>
  typeof x === 'string' ? x : (x?.id ?? null);

const fasciaValida = (v: unknown): v is Abbonamento => (ABBONAMENTI as readonly string[]).includes(String(v));

/**
 * checkout.session.completed (già pagata: lo controlla il chiamante) → l'abbonamento dei servizi
 * nasce nella tabella, il negozio riceve la campanella e Nicola l'avviso. Idempotente: un
 * ritentativo riscrive la stessa riga e non rimanda l'avviso (una volta per abbonamento).
 */
export async function handleServiziSubscription(session: Stripe.Checkout.Session) {
  const sellerId = session.metadata?.seller_id || null;
  const fascia = session.metadata?.fascia;
  const subscriptionId = idDi(session.subscription as string | { id?: string } | null);
  const canone = Number(session.metadata?.canone_centesimi);
  if (!sellerId || !subscriptionId || !fasciaValida(fascia) || !Number.isInteger(canone) || canone <= 0) {
    logger.error('[stripe] abbonamento servizi con dati incompleti', { sessionId: session.id });
    throw new Error(`abbonamento dei servizi con dati incompleti (sessione ${session.id})`);
  }
  const { subscription_status: stato, subscription_renews_at: rinnovo } = await statoDaStripe(subscriptionId);
  const admin = getAdminSupabase();
  // Dal collaudo del 24/11 — DUE ABBONAMENTI PAGATI. Se il negozio ne ha già un altro in corso, questo
  // si registra lo stesso (i soldi sono arrivati) ma si avvisa: niente si annulla da solo, il
  // doppione va disdetto e rimborsato a mano, come per la vetrina (R33-008).
  const { data: altri, error: erroreAltri } = await admin
    .from('abbonamenti_servizi')
    .select('stripe_subscription_id')
    .eq('seller_id', sellerId)
    .in('stato', ['active', 'past_due'])
    .neq('stripe_subscription_id', subscriptionId)
    .limit(5);
  if (erroreAltri) throw new Error(`[stripe] abbonamenti dei servizi non letti: ${erroreAltri.message}`);
  const doppione = (altri ?? []).length > 0 && stato !== 'canceled';
  scritturaObbligatoria(
    await admin.from('abbonamenti_servizi').upsert(
      {
        seller_id: sellerId,
        fascia,
        canone_centesimi: canone,
        stripe_customer_id: idDi(session.customer as string | { id?: string } | null),
        stripe_subscription_id: subscriptionId,
        stato,
        rinnovo_il: rinnovo,
        aggiornato_il: new Date().toISOString(),
      },
      { onConflict: 'stripe_subscription_id' },
    ),
    'attivazione abbonamento dei servizi',
  );
  if (doppione) {
    logger.error('[stripe] abbonamento dei servizi doppio: niente annullato, va disdetto e rimborsato a mano', { sellerId, subscriptionId });
    try {
      await notifyAdmins(
        `Abbonamento servizi DOPPIO: ${session.metadata?.negozio || sellerId}`,
        `Il negozio ha un secondo abbonamento dei servizi (${FASCE[fascia].nome}, ${subscriptionId}) oltre a quello già in corso. Disdici il doppione su Stripe e rimborsalo.`,
        '/admin/users',
        { unaVoltaPer: `abbonamento-servizi-doppio:${subscriptionId}` },
      );
    } catch (err) {
      logger.error('[stripe] avviso abbonamento servizi doppio non scritto', { subscriptionId, err });
    }
    scritturaFacoltativa(
      await admin.from('notifications').insert({
        category: 'order',
        user_id: sellerId,
        title: '⚠️ Hai due abbonamenti ai servizi',
        body: 'Risultano due abbonamenti ai servizi. Non devi fare niente: lo togliamo noi e ti rimborsiamo quello in più.',
        link: PERCORSO_ABBONAMENTO,
      }),
      'avviso abbonamento servizi doppio',
    );
    return;
  }
  if (stato !== 'active') return;

  // 25/11/2026 — Nicola: la scheda del cliente e la pagella arrivano solo dopo l'abbonamento. Al PRIMO
  // abbonamento pagato si aprono (lib/agenzia/abbonamento-attivo-n8n.ts). «Primo» = nessun altro
  // abbonamento ai servizi pagato prima di questo. Una lettura caduta non ferma niente: si salta, e lo dice il log.
  const precedenti = await admin
    .from('abbonamenti_servizi')
    .select('stato')
    .eq('seller_id', sellerId)
    .neq('stripe_subscription_id', subscriptionId)
    .limit(20);
  if (precedenti.error) {
    logger.warn('[stripe] abbonamenti precedenti non letti: scheda e pagella non aperte da qui', { sellerId, message: precedenti.error.message });
  } else if (!schedaEPagellaAperte({ visibileSenzaAbbonamento: false, statiAbbonamenti: (precedenti.data ?? []).map((r) => (r as { stato?: unknown }).stato) })) {
    await alPrimoAbbonamentoPagato(admin, sellerId);
  }

  const nome = FASCE[fascia].nome;
  const primo = canonePrimoMese(canone);
  const negozio = session.metadata?.negozio || 'Un negozio';
  try {
    await notifyAdmins(
      `Abbonamento servizi pagato: ${negozio}`,
      `${negozio} ha pagato l'abbonamento ${nome} (${formatPriceFromCents(canone)} al mese${primo ? `, il primo mese ${formatPriceFromCents(primo)}` : ''}). Fissa con SDG l'incontro nel locale.`,
      '/admin/users',
      { unaVoltaPer: `abbonamento-servizi:${subscriptionId}` },
    );
  } catch (err) {
    // L'abbonamento è già scritto: un avviso mancato non vale un nuovo giro di Stripe.
    logger.error('[stripe] avviso abbonamento servizi non scritto', { subscriptionId, err });
  }
  scritturaFacoltativa(
    await admin.from('notifications').insert({
      category: 'order',
      user_id: sellerId,
      title: `✅ Abbonamento ${nome} attivo`,
      body: `Grazie! Il tuo abbonamento ${nome} è attivo. Ti contattiamo per fissare l’incontro nel locale.`,
      link: PERCORSO_ABBONAMENTO,
    }),
    'avviso abbonamento servizi attivo',
  );
}


// I cambi di stato e le fatture rifiutate dei servizi li smista `abbonamenti.ts` (handleSubscriptionChanged,
// handleInvoicePaymentFailed), così la rotta del webhook resta firma, anti-doppione e smistamento.

/** La sessione pagata è un abbonamento: quello della vetrina (`seller_subscription`) o quello dei servizi. */
export function eSessioneDiAbbonamento(session: Pick<Stripe.Checkout.Session, 'metadata'>): boolean {
  const kind = session.metadata?.kind;
  return kind === KIND_VETRINA || kind === KIND_SERVIZI;
}

/** Smista l'abbonamento pagato: la vetrina va sul profilo (come prima), i servizi nella loro tabella. */
export async function handleAbbonamentoPagato(session: Stripe.Checkout.Session) {
  if (session.metadata?.kind === KIND_SERVIZI) await handleServiziSubscription(session);
  else await handleSellerSubscription(session);
}


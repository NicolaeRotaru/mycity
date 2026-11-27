import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { senzaCampi } from '@/lib/db/migrazione-124';
import { colonnaNonTrovata, type ErroreDatabase } from '@/lib/db/migrazione-148';
import { formatPriceFromCents } from '@/lib/format';
import { notifyAdmins } from './comune';
import { scritturaObbligatoria } from './esito';

/**
 * R11-007 — LA CONTESTAZIONE PARZIALE VINTA RESTITUISCE AL NEGOZIO LA SUA QUOTA.
 *
 * Su una contestazione parziale all'apertura si storna al negozio solo la
 * sua quota (ordine da 50 €, contestati 20 €, stornati 18 €): lo storno non
 * e' pieno, quindi l'ordine resta 'TRANSFERRED' e il ramo della vittoria in dispute.ts
 * rimette in coda solo i 'REVERSED'. Alla vittoria Stripe restituisce i 20 € a MyCity, ma i 18 €
 * restavano tolti al negozio per sempre.
 *
 * Non si rimette in 'HELD': il giro verserebbe di nuovo il netto intero
 * sopra la parte gia' versata. Si restituisce con un bonifico esattamente il
 * promemoria messo da parte all'apertura, poi lo si toglie dallo stornato.
 * La chiave porta la contestazione e il tentativo: se la scrittura dopo il
 * bonifico fallisce, Stripe riprova l'evento e la stessa chiave restituisce
 * lo stesso bonifico invece di farne un secondo.
 */
type RigaContestata = {
  id: string;
  payout_status?: string | null;
  seller_payout_reversed_cents?: number | null;
  dispute_seller_reversed_cents?: number | null;
  seller_id?: string | null;
  stripe_charge_id?: string | null;
  stripe_transfer_group?: string | null;
  payout_tentativo?: number | null;
};

/**
 * Scrive l'ordine; se manca proprio `payout_tentativo` (124) riprova senza.
 *
 * Il promemoria della quota non si toglie mai dalla scrittura: qui è lui il segno «già
 * restituito», e va insieme al tentativo e allo stornato, come nella scrittura intera.
 * Prima, con PostgREST che non conosceva ancora la colonna, il ripiego scriveva il
 * tentativo nuovo e lasciava il promemoria: una ripetizione dell'evento rifaceva il
 * bonifico con una chiave nuova. Adesso o si scrive tutto o niente: la scrittura
 * obbligatoria lancia, Stripe ripete col tentativo di prima e la stessa chiave
 * restituisce lo stesso bonifico.
 */
async function scriviConRipiego(valori: Record<string, unknown>, id: string) {
  const admin = getAdminSupabase();
  const esito = await admin.from('orders').update(valori).eq('id', id);
  if (!esito.error || !colonnaNonTrovata(esito.error as ErroreDatabase, ['payout_tentativo'])) return esito;
  return admin.from('orders').update(senzaCampi(valori, ['payout_tentativo'])).eq('id', id);
}

/**
 * 27/11/2026 — IL BONIFICO GIÀ FATTO SI CERCA SU STRIPE, NON SOLO CON LA CHIAVE.
 *
 * La chiave anti-doppione di Stripe vale 24 ore, ma Stripe ripete l'evento per 3 giorni: se la
 * scrittura dopo il bonifico continua a fallire oltre le 24 ore, la ripetizione con la stessa
 * chiave faceva un secondo bonifico. Prima di crearlo si guarda l'elenco dei bonifici del gruppo
 * (come `bonificoGiaFatto` in lib/stripe/payout.ts): una restituzione di questa contestazione per
 * questo ordine c'è già, si riusa. Se l'elenco non si legge resta la chiave, come prima.
 */
async function restituzioneGiaFatta(gruppo: string, disputeId: string, ordineId: string): Promise<{ id: string } | null> {
  try {
    const esistenti = await getStripe().transfers.list({ transfer_group: gruppo, limit: 100 });
    const trovato = (esistenti.data ?? []).find(
      (t) =>
        t.metadata?.kind === 'dispute_won_restore' &&
        t.metadata?.dispute_id === disputeId &&
        t.metadata?.order_id === ordineId,
    );
    return trovato ? { id: trovato.id } : null;
  } catch (e) {
    logger.warn('[stripe] contestazione parziale vinta: elenco dei bonifici non consultabile, resta la chiave', { orderId: ordineId, e });
    return null;
  }
}

export async function restituisciLeQuoteParziali(dispute: Stripe.Dispute, orders: RigaContestata[]): Promise<void> {
  const admin = getAdminSupabase();
  const parzialiDaRestituire = orders.filter(
    (o) => o.payout_status === 'TRANSFERRED' && (o.dispute_seller_reversed_cents ?? 0) > 0,
  );
  for (const o of parzialiDaRestituire) {
    const riga = o;
    const quota = riga.dispute_seller_reversed_cents ?? 0;
    const tentativo = (riga.payout_tentativo ?? 0) + 1;
    const { data: negozio } = riga.seller_id
      ? await admin.from('profiles').select('stripe_account_id').eq('id', riga.seller_id).maybeSingle()
      : { data: null };
    const conto = (negozio as { stripe_account_id?: string | null } | null)?.stripe_account_id;
    if (!conto) {
      await notifyAdmins(
        '⚠️ Contestazione vinta: quota del negozio da restituire a mano',
        `Ordine ${o.id}: la contestazione ${dispute.id} è vinta, ma il negozio non ha un conto Stripe collegato. Vanno restituiti ${formatPriceFromCents(quota)}.`,
        '/admin/payouts',
      );
      continue;
    }
    // QA del 12/11 — un rifiuto di Stripe qui non deve fermare il resto della vittoria (fattorino,
    // avviso agli amministratori): si dice a chi gestisce, e il promemoria resta per rifarlo.
    let bonifico: { id: string };
    const gruppo = riga.stripe_transfer_group ?? `order_${o.id}`;
    try {
      bonifico = (await restituzioneGiaFatta(gruppo, dispute.id, o.id)) ?? await getStripe().transfers.create(
      {
        amount: quota,
        currency: 'eur',
        destination: conto,
        ...(riga.stripe_charge_id ? { source_transaction: riga.stripe_charge_id } : {}),
        transfer_group: gruppo,
        metadata: { order_id: o.id, seller_id: riga.seller_id ?? '', kind: 'dispute_won_restore', dispute_id: dispute.id,
          // Mai un numero puro: il controllo «bonifico gia' fatto» di payout.ts confronta i tentativi.
          tentativo: `restituzione_${tentativo}` },
      },
      { idempotencyKey: `dispute_won_seller_${dispute.id}_${o.id}_t${tentativo}` },
    );
    } catch (e) {
      logger.error('[stripe] contestazione parziale vinta: quota del negozio non restituita', { orderId: o.id, e });
      await notifyAdmins(
        '⚠️ Contestazione vinta: quota del negozio da restituire a mano',
        `Ordine ${o.id}: la contestazione ${dispute.id} è vinta, ma il bonifico che restituisce al negozio ${formatPriceFromCents(quota)} non è partito (${e instanceof Error ? e.message : 'errore sconosciuto'}). Prima di rifarlo guarda su Stripe se c'è già.`,
        '/admin/payouts',
      );
      continue;
    }
    scritturaObbligatoria(
      await scriviConRipiego(
        {
          seller_payout_reversed_cents: Math.max(0, (o.seller_payout_reversed_cents ?? 0) - quota),
          dispute_seller_reversed_cents: 0,
          payout_tentativo: tentativo,
        },
        o.id,
      ),
      'quota restituita al negozio dopo la contestazione parziale vinta',
    );
    logger.info('[stripe] contestazione parziale vinta: quota restituita al negozio', {
      orderId: o.id, transferId: bonifico.id, centesimi: quota,
    });
  }
}

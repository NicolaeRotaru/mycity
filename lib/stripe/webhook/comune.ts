/**
 * Pezzi condivisi dai gestori del webhook Stripe: chi sono gli admin,
 * quali ordini tocca una contestazione, e se una sessione è davvero pagata.
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
import { COLONNE_124 } from '@/lib/db/migrazione-124';
import { leggiAGradini } from '@/lib/db/ripiego-a-gradini';
import { formatPriceFromCents } from '@/lib/format';
import { scritturaFacoltativa } from './esito';

export type DisputeOrderRow = {
  id: string;
  payout_status: string | null;
  stripe_transfer_id: string | null;
  seller_payout_cents: number | null;
  seller_payout_reversed_cents?: number | null;
  rider_payout_reversed_cents?: number | null;
  /** Promemoria della contestazione (migrazione 126): quanto ha stornato lei. */
  dispute_seller_reversed_cents?: number | null;
  dispute_rider_reversed_cents?: number | null;
  delivery_status?: string | null;
  /** Stato della contestazione bancaria: serve a non ripetere la chiusura (R81). */
  dispute_status?: string | null;
  stripe_reversal_id: string | null;
  // Servono per recuperare anche il compenso versato al fattorino.
  rider_id?: string | null;
  rider_transfer_id: string | null;
  rider_payout_status: string | null;
  rider_fee_cents?: number | null;
  shipping_cost?: number | string | null;
};

/**
 * Le colonne della migrazione 126 che le contestazioni leggono. In produzione
 * la 126 non c'è ancora: senza toglierle, la select intera fallirebbe (42703).
 */
export const COLONNE_126_CONTESTAZIONE = ['dispute_seller_reversed_cents', 'dispute_rider_reversed_cents'] as const;

/** Trova gli ordini legati alla charge/PI di una dispute (multi-seller). */
export async function findOrdersForDispute(dispute: Stripe.Dispute, columns: string): Promise<DisputeOrderRow[]> {
  const admin = getAdminSupabase();
  const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : (dispute.charge?.id ?? null);
  // Il ripiego copre la finestra fra l'unione del codice e la firma sulla
  // migrazione 124. Senza, una `select` che nomina `payout_tentativo` prima
  // che la colonna esista fallisce INTERA: qui l'errore non veniva nemmeno
  // guardato, quindi la contestazione vinta trovava zero ordini e il venditore
  // restava senza soldi in silenzio (lib/db/migrazione-124.ts).
  //
  // 16/10/2026 (riesame del lotto) — Una migrazione alla volta, dalla più
  // nuova. Il ripiego toglieva insieme le colonne della 126 e quelle della 124:
  // in produzione (la 124 c'è, la 126 no) si perdeva `payout_tentativo`, e la
  // contestazione vinta rimetteva in coda il bonifico sempre col tentativo 1
  // (lib/db/ripiego-a-gradini.ts).
  const cerca = async (campo: 'stripe_payment_intent' | 'stripe_charge_id', valore: string) =>
    leggiAGradini(
      `orders.select (contestazione per ${campo})`,
      columns,
      [COLONNE_126_CONTESTAZIONE, COLONNE_124],
      (colonne) => admin.from('orders').select(colonne).eq(campo, valore),
    );

  // 15/10/2026 (R81) — UNA LETTURA CADUTA NON È «NESSUN ORDINE».
  // L'errore qui non si guardava: un timeout del database diventava zero
  // ordini, il gestore scriveva «nessun ordine trovato» e usciva bene, la rotta
  // rispondeva 200 e Stripe non riprovava. Una contestazione aperta in quel
  // momento non bloccava nessun bonifico. Adesso si lancia, e Stripe ripete.
  if (pi) {
    const { data, error } = await cerca('stripe_payment_intent', pi);
    if (error) throw new Error(`[stripe] ordini della contestazione non letti: ${error.message}`);
    if (data && data.length > 0) return data as unknown as DisputeOrderRow[];
  }
  if (chargeId) {
    const { data, error } = await cerca('stripe_charge_id', chargeId);
    if (error) throw new Error(`[stripe] ordini della contestazione non letti: ${error.message}`);
    if (data && data.length > 0) return data as unknown as DisputeOrderRow[];
  }
  return [];
}

/**
 * 057 — Una sessione «completata» non è per forza una sessione PAGATA. Stripe
 * usa `payment_status`: 'paid' o 'no_payment_required' vogliono dire soldi
 * arrivati (o non dovuti); 'unpaid' vuol dire che il pagamento è ancora per
 * strada, come succede con bonifici e pagamenti differiti.
 */
export function sessionePagata(session: Stripe.Checkout.Session): boolean {
  return session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
}

/**
 * Inserisce una notifica per tutti gli admin. È un avviso: se non parte resta
 * scritto nei log, ma non fa ritentare a Stripe un evento già lavorato (R81).
 */
export async function notifyAdmins(title: string, body: string, link: string) {
  const admin = getAdminSupabase();
  const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin');
  if (!admins || admins.length === 0) return;
  scritturaFacoltativa(
    await admin.from('notifications').insert(admins.map((a) => ({ user_id: a.id, title, body, link }))),
    `avviso agli amministratori: ${title}`,
  );
}

/**
 * 30/8/2026 (R005) — UN AVVISO CHE NON PARTE NON NE PORTA VIA ALTRI.
 *
 * Gli avvisi dopo un ordine partivano dentro un ciclo protetto da un solo
 * `.catch()` in fondo: la prima cosa che lanciava interrompeva il giro per
 * tutti gli ordini successivi. Carrello da due o tre negozi pagato con carta,
 * un intoppo sul primo invio, e il secondo e il terzo negoziante non sapevano
 * di avere un ordine — mentre il cliente aveva pagato e aspettava.
 *
 * Ogni invio nel suo riparo, come fa da sempre la strada dei contanti: quello
 * che salta e' solo quello che e' saltato, e resta scritto dove si guarda.
 */
export async function provaAMandare(
  cosa: string,
  dati: Record<string, unknown>,
  invio: () => Promise<unknown>,
): Promise<void> {
  try {
    await invio();
  } catch (e) {
    logger.error(`[stripe] ${cosa} non partita: ordine pagato e destinatario non avvisato`, {
      ...dati,
      message: e instanceof Error ? e.message : 'errore',
    });
  }
}

/**
 * LA CAMPANELLA AL NEGOZIO — la riga in `notifications` da cui parte anche la
 * notifica push (app/api/cron/send-push la legge da lì).
 *
 * 30/8/2026 (R164) — Stava dentro `ordini.ts`, che aveva finito lo spazio: la
 * prova `webhook-diviso-per-mestiere` tiene ogni file del webhook sotto le
 * seicento righe, ed è il freno che impedisce di tornare al file unico da mille
 * righe con dentro otto mestieri. Il posto giusto di un avviso al negozio, che
 * per giunta serve identico a chi paga in contanti, è qui fra i pezzi
 * condivisi. Nessuna logica è cambiata nello spostamento.
 *
 * Non lancia mai: l'ordine c'è ed è pagato, e far ritentare Stripe ricreerebbe
 * il giro intero. Ma un negozio che non riceve la campanella è un ordine che
 * nessuno prepara, quindi il guasto deve restare scritto dove si guarda.
 */
export async function suonaLaCampanellaAiNegozi(
  admin: ReturnType<typeof getAdminSupabase>,
  nuovi: { orderId: string; sellerId: string; totalCents: number; itemsCount: number }[],
  pendingCheckoutId: string,
): Promise<void> {
  if (nuovi.length === 0) return;
  const { error } = await admin.from('notifications').insert(
    nuovi.map((created) => ({
      // #33 — la categoria decide se la persona vuole ancora ricevere questo
      // tipo di avviso: senza, gli interruttori non spegnevano niente.
      category: 'order',
      user_id: created.sellerId,
      title: '📦 Nuovo ordine ricevuto',
      // 6/9/2026 — LA CIFRA QUI SI SCRIVEVA A MANO, E CONTRADDICEVA L'EMAIL.
      // C'era `€${(created.totalCents / 100).toFixed(2)}`: sul telefono del
      // negoziante arrivava «€35.00» mentre l'email dello STESSO ordine, partita
      // nello stesso minuto, diceva gia' «35,00 €». Si passa dalla casa dei formati.
      body: `Ordine #${created.orderId.slice(0, 6).toUpperCase()} · ${formatPriceFromCents(created.totalCents)} · ${created.itemsCount} articoli`,
      link: `/seller/orders/${created.orderId}`,
    })),
  );
  if (error) {
    logger.error('[stripe] campanella al venditore non scritta: ordine pagato e nessuno avvisato', {
      pendingCheckoutId, ordini: nuovi.map((c) => c.orderId), message: error.message,
    });
  }
}

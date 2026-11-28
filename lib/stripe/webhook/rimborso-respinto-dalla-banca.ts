/**
 * Il rimborso che la banca del cliente respinge dopo l'emissione (`charge.refund.updated`).
 *
 * Stava in `lib/stripe/webhook/rimborsi.ts`, che era arrivato a 598 righe sul tetto di 600 di
 * `tests/unit/webhook-diviso-per-mestiere.test.ts` («ogni mestiere ha il suo file»): e' passato qui
 * com'era, e `rimborsi.ts` lo esporta ancora, quindi chi lo importa da li' non cambia niente.
 */
import type Stripe from 'stripe';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { COLONNE_124, conRipiegoSchema, senzaCampi, senzaColonne } from '@/lib/db/migrazione-124';
import { notifyAdmins } from './comune';
import { formatPriceFromCents } from '@/lib/format';
import { PAUSA_RIMBORSO_DA_DIVIDERE } from './rimborsi-da-fuori';
import { pianoDelRimborsoRespinto, type OrdineDelRimborsoRespinto } from '@/lib/stripe/rimborso-respinto';
import { colonnaNonTrovata, type ErroreDatabase } from '@/lib/db/migrazione-148';
import { scritturaObbligatoria } from './esito';

/**
 * 063 — UN RIMBORSO CHE FALLISCE DOPO L'EMISSIONE.
 *
 * `refundOrder` scrive payment_status='REFUNDED' e refunded_amount_cents
 * subito dopo `refunds.create`, cioe' su un rimborso ancora in stato
 * 'pending'. Se poi la banca del cliente lo rifiuta, i soldi rientrano alla
 * piattaforma mentre il database continua a dire che il cliente e' stato
 * rimborsato: lui non riceve niente, chiama, e ai nostri occhi risulta gia'
 * liquidato. E' l'innesco tipico di una contestazione che poi si perde,
 * perche' le nostre prove dicono il contrario di quello che e' successo.
 */
/**
 * 13/11/2026 (R17-014) — IL RIMBORSO RESPINTO LIBERA LA SUA PRENOTAZIONE NEL LIBRO.
 *
 * Dalla migrazione 412 `refundOrder` prenota il rimborso con la chiave che va a Stripe
 * (`metadata.chiave_rimborso`), e la stessa chiave non si somma due volte. Qui l'importo respinto si
 * toglie dall'ordine con la scrittura del segno «respinto», ma la prenotazione della chiave restava:
 * rifatto con la stessa chiave (lo stesso reso rimborsato di nuovo dopo il rifiuto della banca), il
 * rimborso nuovo usciva senza contarsi, e il libro diceva 0 € su 20 usciti. Si toglie la riga, non
 * l'importo (già tolto qui sopra). Un database senza la 412 non ha la tabella: niente da togliere.
 * Un'altra caduta lancia: Stripe riprova l'avviso, e il segno già scritto non fa rifare il resto.
 */
async function liberaLaPrenotazioneNelLibro(admin: ReturnType<typeof getAdminSupabase>, refund: Stripe.Refund): Promise<void> {
  const m = (refund.metadata ?? {}) as Record<string, string>;
  const ordine = (m.order_id ?? '').trim();
  const chiave = (m.chiave_rimborso ?? '').trim();
  if (!ordine || !chiave) return;
  const { error } = await admin.from('prenotazioni_dei_rimborsi').delete().eq('order_id', ordine).eq('chiave', chiave);
  if (!error) return;
  const codice = (error as { code?: string }).code;
  if (codice === 'PGRST205' || codice === '42P01') return;
  throw new Error(`[stripe] prenotazione del rimborso respinto non tolta dal libro: ${error.message}`);
}

export async function handleRefundUpdated(refund: Stripe.Refund) {
  if (refund.status !== 'failed' && refund.status !== 'canceled') return;

  const admin = getAdminSupabase();
  const paymentIntent = typeof refund.payment_intent === 'string'
    ? refund.payment_intent
    : refund.payment_intent?.id ?? null;
  if (!paymentIntent) {
    logger.warn('[stripe] rimborso fallito senza payment_intent', { refundId: refund.id });
    return;
  }

  // Prima che la migrazione 124 sia applicata, `gross_total_cents` non esiste e
  // il database rifiuta la lettura INTERA: l'ordine risultava «non trovato», il
  // rimborso rifiutato dalla banca non veniva registrato e nessuno avvisava
  // l'admin. I soldi restavano fermi in silenzio (lib/db/migrazione-124.ts).
  // 27/8/2026 (R039) — servono anche i campi del bonifico al negozio: quando i
  // soldi rientrano va rimesso in coda quello che il rimborso aveva chiuso.
  // 16/10/2026 (riesame del lotto) — serve anche `stripe_refund_id`: dice se questo
  // rimborso respinto è già stato rimesso a posto (lib/stripe/rimborso-respinto.ts).
  const COLONNE_RIMBORSO_FALLITO = 'id, refunded_amount_cents, gross_total_cents, total_price, payment_status, payout_status, seller_payout_cents, seller_payout_reversed_cents, payout_tentativo, stripe_refund_id, internal_dispute_status';

  // 21/8/2026 — UN CARRELLO DA DUE NEGOZI E' DUE ORDINI CON LO STESSO PAGAMENTO.
  //
  // Qui si cercava l'ordine con `.maybeSingle()` sul payment_intent. Ma
  // `handleCheckoutCompleted` crea un ordine per ogni negozio del carrello e
  // scrive su tutti lo STESSO payment_intent: con due negozi la lettura
  // rispondeva «piu' di una riga», il codice leggeva `null` e usciva scrivendo
  // «nessun ordine trovato». Il rimborso che la banca rifiuta non tornava
  // indietro da nessuna parte: i soldi rientravano a noi e il database
  // continuava a dire «cliente rimborsato».
  //
  // Prima si guarda l'etichetta che `refundOrder` scrive sul rimborso
  // (`metadata.order_id`): quella indica l'ordine esatto e chiude il caso senza
  // ripartizioni. Se manca — rimborso creato a mano dal cruscotto Stripe — si
  // leggono TUTTI gli ordini di quel pagamento e l'importo rientrato si divide
  // fra loro in proporzione a quanto risultava rimborsato su ciascuno.
  const idDaEtichetta = (refund.metadata?.order_id ?? '').trim();
  const leggi = (colonne: string) =>
    idDaEtichetta
      ? admin.from('orders').select(colonne).eq('id', idDaEtichetta)
      : admin.from('orders').select(colonne).eq('stripe_payment_intent', paymentIntent);

  const { data: ordiniLetti, error: errLettura } = await conRipiegoSchema(
    'orders.select (rimborso rifiutato)',
    () => leggi(COLONNE_RIMBORSO_FALLITO),
    () => leggi(senzaColonne(COLONNE_RIMBORSO_FALLITO, COLONNE_124)),
  );
  // R81 — una lettura caduta non è «nessun ordine trovato»: Stripe deve riprovare.
  if (errLettura) throw new Error(`[stripe] ordini del rimborso rifiutato non letti: ${(errLettura as { message?: string }).message ?? 'errore'}`);
  const ordini = (ordiniLetti ?? []) as unknown as OrdineDelRimborsoRespinto[];
  if (ordini.length === 0) {
    logger.warn('[stripe] rimborso fallito: nessun ordine trovato', { refundId: refund.id, paymentIntent });
    // 5/11/2026 — Il webhook stesso rimborsa pagamenti senza ordine (riserva
    // scaduta, conto che non torna, fascia persa: portano pending_checkout_id o
    // motivo), e cosi' i buoni regalo. Se la banca li respinge, i soldi tornano
    // a MyCity e il cliente resta senza: lo si dice, una volta per rimborso.
    const m = (refund.metadata ?? {}) as Record<string, string>;
    if (m.pending_checkout_id || m.motivo || m.kind) {
      const carrello = m.pending_checkout_id?.trim() || null;
      let cliente: string | null = null;
      if (carrello) {
        const { data: pc } = await admin.from('pending_checkouts').select('buyer_id').eq('id', carrello).maybeSingle();
        cliente = (pc as { buyer_id?: string | null } | null)?.buyer_id ?? null;
      }
      await notifyAdmins(
        '⚠️ Rimborso senza ordine respinto dalla banca',
        `La banca ha respinto il rimborso ${refund.id} da ${formatPriceFromCents(refund.amount ?? 0)} su un pagamento senza ordine` +
          (m.motivo ? ` (${m.motivo})` : '') +
          (carrello ? `, carrello ${carrello}` : '') +
          (cliente ? `, cliente ${cliente}` : '') +
          '. I soldi sono tornati a MyCity: il cliente va rimborsato in un altro modo.',
        '/admin/orders',
        { unaVoltaPer: `rimborso-respinto:${refund.id}` },
      );
    }
    return;
  }

  const tornatoIndietro = refund.amount ?? 0;
  // Quanto torna su ciascun ordine, cosa si scrive, e quali ordini questo
  // rimborso respinto l'hanno già visto: il conto sta in lib/stripe/rimborso-respinto.ts
  // (16/10/2026, riesame del lotto). R28-014 — un rimborso dal cruscotto (senza
  // l'etichetta dell'ordine) su un carrello fermo per la divisione si toglie solo
  // dagli ordini che l'hanno scritto nel loro elenco: gli altri non l'hanno mai avuto.
  const piano = pianoDelRimborsoRespinto(ordini, refund.id ?? '', tornatoIndietro, idDaEtichetta ? {} : { pausaDellaDivisione: PAUSA_RIMBORSO_DA_DIVIDERE });

  // 16/10/2026 (quinto riesame del lotto) — L'avviso porta la chiave del
  // rimborso: arriva una volta sola anche se lo si chiede a ogni passaggio
  // (vedi `notifyAdmins`). Prima, al passaggio che trovava tutti i segni già
  // scritti, l'avviso si saltava: se il primo si era fermato fra la scrittura e
  // l'avviso (una risposta del database persa, il processo morto), il cliente
  // restava senza rimborso e nessuno lo sapeva.
  // 5/11/2026 — L'avviso dice quello che e' successo davvero al bonifico del
  // negozio: rimesso in coda solo se questo passaggio l'ha rimesso; se non
  // c'era niente da rimettere (bonifico in corso, o mai chiuso) non lo promette.
  const rimessiInCoda = piano.scritture.filter((p) => p.valori.payout_status === 'HELD').length;
  const fraseDelBonifico =
    piano.scritture.length === 0
      ? (piano.giaFatti.length > 0 ? "Questo rimborso respinto era già stato registrato: controlla sull'ordine lo stato del bonifico al negozio." : "Non era ancora scritto su nessun ordine (aspettava la divisione fra i negozi): gli importi degli ordini restano com'erano.")
      : rimessiInCoda > 0
        ? "Il bonifico al negozio e' stato rimesso in coda."
        : "Il bonifico al negozio non era da rimettere in coda (non era stato chiuso dal rimborso).";
  const avvisaGliAmministratori = () =>
    notifyAdmins(
      '⚠️ Rimborso rifiutato dalla banca',
      `Il rimborso di ${formatPriceFromCents(tornatoIndietro)} su ${ordini.length === 1 ? `l'ordine ${ordini[0].id}` : `${ordini.length} ordini dello stesso pagamento`} non e' arrivato al cliente (${refund.status}). I soldi sono rientrati: va rimborsato in un altro modo. ${fraseDelBonifico} Se il rimborso era pieno e l'ordine non era ancora consegnato, la merce era stata rimessa a scaffale e la giacenza va ricontrollata a mano.`,
      '/admin/orders',
      refund.id ? { unaVoltaPer: `rimborso-respinto:${refund.id}` } : {},
    );

  if (piano.scritture.length === 0) {
    // Lo stesso rimborso respinto è già stato rimesso a posto su tutti gli
    // ordini: niente da rifare. L'avviso si chiede lo stesso, e se c'è già
    // non parte una seconda volta (leggerlo due volte vorrebbe dire
    // rimborsare il cliente due volte a mano).
    logger.info('[stripe] rimborso respinto già registrato: niente da rifare', { refundId: refund.id, ordini: piano.giaFatti });
    if (refund.id) await avvisaGliAmministratori();
    await liberaLaPrenotazioneNelLibro(admin, refund);
    return;
  }

  for (const passo of piano.scritture) {
    const {
      refunded_amount_cents: rimborsato,
      payout_status: statoBonifico,
      stripe_refund_id: elenco,
      seller_payout_reversed_cents: quotaTolta,
    } = passo.seAncora;
    // La scrittura passa solo se l'ordine è ancora quello letto. Se non prende
    // la riga, qualcuno l'ha cambiato nel frattempo (anche un secondo passaggio
    // dello stesso avviso): si lancia, Stripe riprova, e la rilettura decide
    // sui numeri nuovi — col segno già scritto, questo ordine non si ritocca.
    const scrivi = (valori: Record<string, unknown>) => {
      let q = admin.from('orders').update(valori).eq('id', passo.ordineId);
      q = rimborsato === null ? q.is('refunded_amount_cents', null) : q.eq('refunded_amount_cents', rimborsato);
      q = statoBonifico === null ? q.is('payout_status', null) : q.eq('payout_status', statoBonifico);
      q = elenco === null ? q.is('stripe_refund_id', null) : q.eq('stripe_refund_id', elenco);
      q = quotaTolta === null ? q.is('seller_payout_reversed_cents', null) : q.eq('seller_payout_reversed_cents', quotaTolta);
      return q.select('id');
    };
    // Prima della migrazione 124 la colonna del tentativo non esiste: meglio
    // rimettere il bonifico in coda senza quel numero che non rimetterlo
    // affatto. Su una scrittura risponde PostgREST (PGRST204), non PostgreSQL:
    // per questo `colonnaNonTrovata` e non `conRipiegoSchema`.
    let esito = await scrivi(passo.valori);
    if (esito.error && colonnaNonTrovata(esito.error as ErroreDatabase)) {
      logger.warn('[stripe] colonna nuova non ancora nel database: riscrivo senza', {
        dove: 'orders.update (rimborso respinto dalla banca)', senza: ['payout_tentativo'],
      });
      esito = await scrivi(senzaCampi(passo.valori, ['payout_tentativo']));
    }
    // Da quando c'è il segno, ripetere è sicuro: se il database dice di no,
    // Stripe riprova invece di lasciare il cliente «rimborsato» per sempre.
    const { data: scritti } = scritturaObbligatoria(esito, 'rimborso respinto dalla banca registrato sull ordine');
    if (!scritti || scritti.length === 0) {
      throw new Error(`[stripe] rimborso respinto sull'ordine ${passo.ordineId}: l'ordine è cambiato nel frattempo, si riprova`);
    }
  }

  await avvisaGliAmministratori();
  await liberaLaPrenotazioneNelLibro(admin, refund);
}

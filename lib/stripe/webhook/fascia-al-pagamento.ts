/**
 * 31/10/2026 (ondata 5) — CON LA CARTA LA FASCIA SI GUARDA QUANDO SI PAGA.
 *
 * ── Il difetto ──────────────────────────────────────────────────────────────────────────────
 * La rotta della carta controlla la fascia quando apre la pagina di Stripe; la pagina resta
 * pagabile per ore, e l'ordine nasce al webhook. Lunedì alle 12:40 «Oggi · 13:00–16:30» passa
 * (Pane Quotidiano chiude alle 13:00, resta il quarto d'ora del ritiro); pagata alle 12:47 o alle
 * 13:01 nasceva un ordine che il negozio non poteva più servire, e il giro lo annullava mezz'ora
 * dopo dicendo al cliente «il negozio non ha accettato in tempo». E l'etichetta è relativa:
 * «Domani» scelto alle 23:50 e pagato alle 00:10 finiva su un ordine nato martedì, e negozio,
 * fattorino, cliente ed email leggevano mercoledì.
 *
 * ── La regola ───────────────────────────────────────────────────────────────────────────────
 * ① L'etichetta si riporta al giorno in cui nasce l'ordine (`fasciaAlGiornoDellOrdine`): tutti i
 *   lettori la contano da `orders.created_at`, e così il conto torna senza colonne nuove.
 * ② La regola unica dei contanti (`motivoFasciaRifiutata`) si rifà adesso, cioè quando l'ordine
 *   nasce: è lo stesso istante da cui contano la scadenza d'accettazione e il giro. Se dice no si
 *   rimborsa subito, con una chiave stabile, e non nasce nessun ordine. La finestra si stringe
 *   soltanto col passare del tempo, quindi un evento riconsegnato non cambia la risposta.
 * ③ Il rimborso lo sa anche il cliente (`diciloAlCliente`): campanella ed email con quanto torna,
 *   perché, e che non c'è nessun ordine. Prima lo sapevano solo gli amministratori, e dopo 30
 *   secondi la pagina degli ordini gli diceva «nessun ordine»: soldi addebitati e spariti.
 * Prove: `tests/unit/con-la-carta-la-fascia-si-guarda-quando-si-paga.test.ts`,
 * `tests/unit/rimborso-della-fascia-persa-il-cliente-lo-sa.test.ts`.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import type { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email/client';
import { env } from '@/lib/env';
import { formatPriceFromCents } from '@/lib/format';
import { escapeHtml } from '@/lib/html-escape';
import { idDaChiave, notifyAdmins, provaAMandare } from './comune';
import { scritturaFacoltativa } from './esito';
import { merceDelCarrello } from './quadratura';

type Admin = ReturnType<typeof getAdminSupabase>;

/** Gli orari dei negozi del carrello, letti adesso. Una lettura caduta non è «negozio aperto»: Stripe riprova. */
export async function orariDeiNegozi(admin: Admin, groups: readonly { sellerId: string; storeName?: string | null }[]): Promise<{ nome: string; orari: unknown }[]> {
  const negozi: { nome: string; orari: unknown }[] = [];
  for (const g of groups) {
    const { data, error } = await admin.from('profiles').select('store_name, store_hours').eq('id', g.sellerId).maybeSingle();
    if (error) throw new Error(`[stripe] orari del negozio non letti per la fascia (${error.message})`);
    const riga = data as { store_name?: string | null; store_hours?: unknown } | null;
    negozi.push({ nome: g.storeName || riga?.store_name || 'Il negozio', orari: riga?.store_hours });
  }
  return negozi;
}

/**
 * La fascia non si può più mantenere: rimborso con chiave stabile, carrello chiuso, merce e
 * codice sconto restituiti. `false` se degli ordini sono già nati da un tentativo precedente:
 * lì non si rimborsa merce in lavorazione (la regola del carrello scaduto, 162).
 */
export async function rimborsaLaFasciaPersa(
  admin: Admin,
  session: Stripe.Checkout.Session,
  pendingCheckoutId: string,
  motivo: string,
  cliente: { buyerId: string; fascia: string },
): Promise<boolean> {
  const { data: giaNati, error: errGiaNati } = await admin.from('orders').select('id').eq('stripe_session_id', session.id);
  if (errGiaNati) throw new Error(`[stripe] fascia non più possibile: ordini non letti (${errGiaNati.message})`);
  if (giaNati && giaNati.length > 0) {
    logger.warn('[stripe] fascia non più possibile ma ordini già nati: si prosegue', { pendingCheckoutId, motivo });
    return false;
  }
  logger.error('[stripe] fascia non più possibile al pagamento: rimborso', { pendingCheckoutId, motivo });
  const pagamento = typeof session.payment_intent === 'string' ? session.payment_intent : null;
  if (pagamento && (session.amount_total ?? 0) > 0) {
    try {
      await getStripe().refunds.create(
        { payment_intent: pagamento, metadata: { motivo: 'fascia_non_piu_possibile', pending_checkout_id: pendingCheckoutId } },
        { idempotencyKey: `refund_fascia_${pendingCheckoutId}` },
      );
    } catch (err) {
      logger.error('[stripe] rimborso per fascia non più possibile non riuscito', { pendingCheckoutId, err });
      throw err;
    }
  }
  const esito = await admin
    .from('pending_checkouts')
    .update({ status: 'CANCELED' })
    .eq('id', pendingCheckoutId)
    .eq('status', 'PENDING')
    .select('id, groups, coupon_code');
  scritturaFacoltativa(esito, 'carrello chiuso per fascia non più possibile');
  const carrello = (esito.data as Array<{ groups?: unknown; coupon_code?: string | null }> | null)?.[0];
  if (carrello) {
    const merce = merceDelCarrello(carrello.groups);
    if (merce.length > 0) {
      const { error } = await admin.rpc('restore_stock', { p_items: merce });
      if (error) logger.error('[stripe] fascia non più possibile: merce non rimessa in vendita', { pendingCheckoutId, message: error.message });
    }
    const codice = carrello.coupon_code?.trim();
    if (codice) {
      const { error } = await admin.rpc('release_coupon', { p_code: codice });
      if (error) logger.warn('[stripe] fascia non più possibile: codice sconto non restituito', { pendingCheckoutId, message: error.message });
    }
  }
  await diciloAlCliente(admin, session, pendingCheckoutId, motivo, cliente);
  await notifyAdmins(
    '⚠️ Pagamento rimborsato: fascia non più possibile',
    `Il carrello ${pendingCheckoutId} è stato pagato quando la fascia scelta non si poteva più servire (${motivo}). Rimborsato in automatico, nessun ordine creato.`,
    '/admin/orders',
    { unaVoltaPer: `fascia-persa:${pendingCheckoutId}` },
  );
  return true;
}

/**
 * Il cliente ha pagato e non nasce nessun ordine: glielo si dice, una volta sola. La campanella ha
 * un id che dipende dal carrello, quindi Stripe che riconsegna l'evento trova la riga già scritta
 * (23505) e l'email non riparte. Non lancia mai: il rimborso è già fatto, e far ritentare Stripe
 * per un avviso rifarebbe tutto il giro. Un avviso che non parte resta scritto nel registro.
 */
async function diciloAlCliente(
  admin: Admin,
  session: Stripe.Checkout.Session,
  pendingCheckoutId: string,
  motivo: string,
  cliente: { buyerId: string; fascia: string },
): Promise<void> {
  const importo = formatPriceFromCents(session.amount_total ?? 0);
  const titolo = '💶 Pagamento rimborsato: nessun ordine creato';
  const frase = `Hai pagato ${importo}, ma quando è arrivato il pagamento la consegna «${cliente.fascia}» non si poteva più fare. ` +
    `Ti abbiamo rimborsato tutto e nessun ordine è stato creato.`;
  const banca = 'Il rimborso torna sulla carta che hai usato, di solito entro 5-10 giorni lavorativi: i tempi li decide la tua banca.';
  const { error } = await admin.from('notifications').insert({
    id: idDaChiave(`fascia-persa-cliente:${pendingCheckoutId}`),
    category: 'order',
    user_id: cliente.buyerId,
    title: titolo,
    body: `${frase} Puoi rifare l'ordine con un'altra fascia.`,
    link: '/cart',
  });
  if ((error as { code?: string } | null)?.code === '23505') return;
  if (error) logger.error('[stripe] fascia non più possibile: campanella al cliente non scritta', { pendingCheckoutId, message: error.message });
  const destinatario = session.customer_details?.email ?? session.customer_email ?? null;
  if (!destinatario) return;
  const carrello = `${env.appUrl().replace(/\/$/, '')}/cart`;
  const testo = `${frase} Motivo: ${motivo} ${banca} Puoi rifare l'ordine con un'altra fascia: ${carrello}`;
  const p = (t: string) => `<p style="margin:0 0 12px;line-height:1.6">${escapeHtml(t)}</p>`;
  await provaAMandare('email di rimborso per fascia non più possibile', { pendingCheckoutId }, () => sendEmail({
    to: destinatario,
    subject: `💶 Rimborso di ${importo}: la consegna scelta non era più possibile`,
    html: `${p(frase)}${p(`Motivo: ${motivo}`)}${p(banca)}<p style="margin:24px 0"><a href="${escapeHtml(carrello)}">Rifai l'ordine con un'altra fascia</a></p>`,
    text: testo,
  }));
}

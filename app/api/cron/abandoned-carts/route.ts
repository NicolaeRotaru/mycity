import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/client';
import { env } from '@/lib/env';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { escapeHtml } from '@/lib/html-escape';
import { logger } from '@/lib/logger';

/**
 * Cron endpoint per inviare email "Hai dimenticato qualcosa" agli utenti
 * che hanno abbandonato il carrello da > 4h.
 *
 * Esperti senior consultati:
 * - CRM Manager: "Recovery email a 4h post-abbandono = sweet spot
 *   tra urgenza e rispetto utente. > 24h = troppo tardi."
 * - Behavioral Scientist: "Show carrello content visivo + 1 CTA forte.
 *   Niente vendita aggressiva."
 * - Trust & Safety: "Idempotent via recovery_email_sent_at flag = mai 2 email."
 *
 * Cadenza: ogni ora. Chi la fa partire sta in `vercel.json` → `crons`.
 * A mano si chiama così:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yoursite/api/cron/abandoned-carts
 */

export const runtime = 'nodejs';

const handler = withCronAuth(async (): Promise<NextResponse> => {
  // 27/8/2026 (R009) — IL CLIENT AMMINISTRATIVO SI PRENDE DA UN POSTO SOLO.
  // Qui se ne costruiva uno a mano: cinque copie in giro per il progetto, e
  // ognuna e' un posto in piu' da ricordare il giorno in cui la chiave di
  // servizio va ruotata o vanno cambiate le opzioni del client (per esempio per
  // mettere un tetto di tempo). Dimenticarne una vuol dire una rotta che smette
  // di funzionare in silenzio. `getAdminSupabase()` tiene da parte un client
  // solo (#245: ogni client porta la sua coda di connessioni e i suoi timer).
  let supa;
  try { supa = getAdminSupabase(); } catch (e) { return ApiErrors.unavailable(e instanceof Error ? e.message : 'service unavailable'); }

  const { data, error } = await supa.rpc('list_abandoned_carts_to_recover', { min_hours: 4 });
  if (error) return ApiErrors.internal(error.message);

  const candidates = (data ?? []) as Array<{ user_id: string; email: string; full_name: string | null; cart_data: unknown; cart_total: number }>;
  let sent = 0, errors = 0, skipped = 0;

  /**
   * 22/8/2026 — UNA DOMANDA AL DATABASE PER OGNI PERSONA, DENTRO IL CICLO.
   *
   * Il consenso si leggeva una riga alla volta: con duecento carrelli
   * abbandonati erano duecento andate e ritorno, in fila una dopo l'altra,
   * dentro un lavoro che ha un tempo massimo. Il giro non falliva: si fermava
   * a metà quando scadeva il tempo, e i carrelli rimasti li riprovava il giro
   * dopo, sempre fermandosi allo stesso punto.
   *
   * Qui la domanda si fa una volta sola, per tutti.
   */
  const consensoPerPersona = new Map<string, boolean>();
  if (candidates.length > 0) {
    const { data: profili } = await supa
      .from('profiles')
      .select('id, email_marketing')
      .in('id', candidates.map((c) => c.user_id));
    for (const p of (profili ?? []) as Array<{ id: string; email_marketing: boolean | null }>) {
      consensoPerPersona.set(p.id, !!p.email_marketing);
    }
  }

  for (const c of candidates) {
    // Consenso: l'email di recupero carrello è marketing → inviala solo a chi
    // ha dato consenso (email_marketing). Senza consenso: marca come gestito
    // così il cron non riprova ad ogni giro.
    if (!consensoPerPersona.get(c.user_id)) {
      skipped++;
      const { error: errMarca } = await supa.rpc('mark_abandoned_cart_email_sent', { p_user: c.user_id });
      if (errMarca) logger.error('[abandoned-carts] marcatura fallita (senza consenso)', errMarca);
      continue;
    }

    // 183 — Prima si spediva e POI si marcava, senza guardare l'esito della
    // marcatura. Se la marcatura falliva, al giro dopo la stessa persona
    // riceveva la stessa email; e chi la riceve due volte la segna come spam.
    // Ora si rivendica prima: si scrive solo a chi si è riusciti a marcare.
    const { error: errClaim } = await supa.rpc('mark_abandoned_cart_email_sent', { p_user: c.user_id });
    if (errClaim) {
      logger.error('[abandoned-carts] rivendicazione fallita, non spedisco', errClaim);
      errors++;
      continue;
    }
    const itemsList = Array.isArray(c.cart_data)
      ? (c.cart_data as Array<{ quantity?: number; name?: string }>).slice(0, 5).map((i) => `<li>${i.quantity ?? 1}× ${escapeHtml(i.name ?? 'Prodotto')}</li>`).join('')
      : '';
    const first = c.full_name?.split(' ')[0] ?? '';
    const res = await sendEmail({
      to: c.email,
      subject: 'Hai dimenticato qualcosa nel carrello',
      html: `<p>Ciao ${escapeHtml(first)},</p>
             <p>Il tuo carrello (€${Number(c.cart_total).toFixed(2)}) ti aspetta.</p>
             ${itemsList ? `<ul>${itemsList}</ul>` : ''}
             <p><a href="${env.appUrl()}/cart" style="background:#C0492C;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Completa l&apos;acquisto →</a></p>
             <p style="font-size:12px;color:#888">Se hai cambiato idea, ignora questa email. Non ti scriveremo più per questo carrello.</p>`,
      text: `Il tuo carrello ti aspetta. Totale €${Number(c.cart_total).toFixed(2)}. Vai su ${env.appUrl()}/cart.`,
      tags: [{ name: 'template', value: 'abandoned_cart_4h' }],
    });
    if ('ok' in res && res.ok) {
      sent++;
    } else {
      errors++;
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, errors, candidates: candidates.length });
});

export const POST = handler;
export const GET = handler;

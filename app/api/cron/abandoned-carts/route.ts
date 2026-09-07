import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/client';
import { preparaEmailCicloDiVita } from '@/lib/email/templates';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { potaCarrelliRecuperati } from '@/lib/carrelli-abbandonati';

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
    // 6/9/2026 — QUESTA EMAIL PARTIVA NUDA, MENTRE IL TEMPLATE ESISTEVA GIA'.
    //
    // Qui si costruivano a mano quattro paragrafi: niente <html>, niente testata
    // col nome MyCity, niente piede coi link legali, e un pulsante terracotta
    // scritto a mano. Intanto `lib/email/templates.ts` aveva gia'
    // `abandoned_cart_4h` dentro il guscio comune, con lo stesso tag. Due case
    // per lo stesso messaggio: quella che parte davvero era la nuda, cioe' la
    // meno riconoscibile proprio nell'email che deve riportare a pagare.
    //
    // Il totale continua a NON comparire, ed e' voluto (vedi il template):
    // `cart_total` e' la fotografia di quando il carrello e' stato lasciato e
    // puo' non esistere piu'. La lista di cosa c'e' dentro basta a far tornare;
    // il totale vero lo dice il carrello, che lo rilegge dal database.
    const messaggio = preparaEmailCicloDiVita('abandoned_cart_4h', {
      name: c.full_name,
      cartItems: Array.isArray(c.cart_data)
        ? (c.cart_data as Array<{ quantity?: number; name?: string }>)
        : null,
    });
    if (!messaggio) {
      logger.error('[abandoned-carts] template abandoned_cart_4h introvabile, non spedisco');
      errors++;
      continue;
    }
    const res = await sendEmail({
      to: c.email,
      subject: messaggio.subject,
      html: messaggio.html,
      text: messaggio.text,
      tags: [{ name: 'template', value: 'abandoned_cart_4h' }],
    });
    if ('ok' in res && res.ok) {
      sent++;
    } else {
      errors++;
    }
  }

  /**
   * 30/8/2026 (R164) — LA POTATURA DELLE RIGHE GIA' RECUPERATE.
   *
   * Da oggi la riga di un carrello che e' diventato ordine non si cancella
   * piu': si marca, altrimenti la campagna non si puo' misurare. Ma «non si
   * cancella piu'» senza un taglio vuol dire tenere per sempre la spesa di una
   * persona, e non c'e' nessun motivo per farlo. Il tempo che si tiene sta in
   * GIORNI_DI_MEMORIA_CARRELLI: dopo, la misura l'ha gia' letta chi doveva.
   */
  const potate = await potaCarrelliRecuperati(supa);

  return NextResponse.json({ ok: true, sent, skipped, errors, potate, candidates: candidates.length });
});

export const POST = handler;
export const GET = handler;

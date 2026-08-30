import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email/client';
import { requireSupabaseService } from '@/lib/env';
import { preparaEmailCicloDiVita } from '@/lib/email/templates';
import { withCronAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';

/**
 * Cron endpoint per inviare email lifecycle dalla queue.
 *
 * Esperti senior consultati:
 * - CRM Manager: "Lifecycle automatico = retention non-bruciante. Welcome /
 *   tutorial / re-engagement / win-back tutti via DB-driven queue."
 * - SRE: "Idempotent. Limit 50/run per evitare timeout serverless. Lock-free
 *   via UPDATE … RETURNING (atomic claim)."
 * - Trust & Safety: "Authorization via CRON_SECRET header. Service role only."
 *
 * Cadenza: ogni 10 minuti. Chi la fa partire sta in `vercel.json` → `crons`.
 * A mano si chiama così:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yoursite/api/cron/send-emails
 */

export const runtime = 'nodejs';

/**
 * 27/8/2026 (R007) — I TEMPLATE NON VIVONO PIU' QUI DENTRO.
 *
 * Erano sei, scritti a mano in questo file: `<p>` nudi, senza intestazione col
 * marchio e senza piede, e il benvenuto ci interpolava dentro il nome
 * dell'utente senza nessun filtro. Erano un secondo elenco parallelo a
 * `lib/email/templates.ts`, che invece aveva gia' impaginazione comune e
 * filtro — e siccome e' questo giro a spedire il benvenuto, il messaggio che la
 * gente riceveva davvero era quello scritto peggio.
 *
 * Adesso li prepara `preparaEmailCicloDiVita`, che sta con tutti gli altri.
 */

// Template relazionali/onboarding (welcome, tutorial): esenti dal consenso
// marketing — l'utente che si iscrive li attende. Gli altri sono marketing.
const TRANSACTIONAL_TEMPLATES = new Set(['welcome', 'tutorial_day2']);

/**
 * Segna una riga come annullata e, se la scrittura non riesce, lo dice. Senza
 * questo, una riga che non si riesce ad annullare torna nel giro dopo e prova a
 * partire di nuovo — in silenzio.
 */
async function annullaRiga(supa: { from: (t: string) => any }, id: unknown): Promise<void> {
  const { error } = await supa
    .from('email_queue')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    logger.error('[cron] riga di posta non annullata: tornera nel prossimo giro', {
      id, message: error.message,
    });
  }
}

const handler = withCronAuth(async (_req): Promise<NextResponse> => {
  let supaCfg;
  try { supaCfg = requireSupabaseService(); } catch (e) {
    return ApiErrors.unavailable(e instanceof Error ? e.message : 'config error');
  }
  const supa = createClient(supaCfg.url, supaCfg.key, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1) Claim batch (atomic UPDATE … RETURNING per evitare double-send)
  /**
   * 22/8/2026 — CINQUANTA EMAIL IN QUINDICI MINUTI DI PRENOTAZIONE.
   *
   * La prenotazione di una riga scade dopo quindici minuti (migrazione 085).
   * Questo giro ne prendeva cinquanta e le lavorava in fila, ognuna con quattro
   * viaggi al database piu' la chiamata al servizio di posta: sulle ultime la
   * prenotazione poteva essere gia' scaduta, e un secondo giro partito nel
   * frattempo rimandava la stessa email. La stessa persona riceveva due volte
   * lo stesso messaggio, e il registro ne segnava uno.
   *
   * Quindici bastano per il volume di oggi e stanno larghe dentro la finestra.
   * Le altre non si perdono: restano in coda per il giro dopo.
   */
  const { data: batch, error: claimErr } = await supa.rpc('claim_pending_emails', { p_max: 15 });
  if (claimErr) {
    // 🟠-11: NIENTE fallback "select senza claim" — in multi-istanza due run
    // sovrapposti invierebbero la stessa email due volte. Meglio fallire e
    // ritentare al giro successivo (il claim atomico è l'unico path sicuro).
    logger.error('[cron] claim_pending_emails fallita', { message: claimErr.message });
    return ApiErrors.unavailable('Email queue claim non disponibile');
  }

  return await processBatch(supa, (batch ?? []) as any[]);
});

export const GET = handler;
export const POST = handler;

// SupabaseClient<any> per evitare generic mismatch tra createClient (any-default)
// e Database type (mai generato). Sicuro perche' processBatch fa solo query
// validate al runtime.
// Acceptable any: tipo Supabase troppo restrittivo senza Database type.
// eslint-disable-next-line
async function processBatch(supa: any, batch: { id: string; user_id: string; template: string; attempts?: number }[]): Promise<NextResponse> {
  let sent = 0, skipped = 0, errors = 0;

  /**
   * 22/8/2026 — QUATTRO VIAGGI AL DATABASE PER OGNI EMAIL SPEDITA.
   *
   * Il ciclo faceva tutto in fila, riga per riga: leggi il profilo, leggi
   * l'indirizzo dall'autenticazione, spedisci, scrivi l'esito. Con quindici
   * email sono sessanta viaggi in sequenza, ognuno con la sua attesa — e la
   * prenotazione delle righe scade dopo quindici minuti.
   *
   * I profili si leggono tutti insieme, una volta. Non tocco il turno atomico
   * di `claim_pending_emails`: e' quello che impedisce il doppio invio quando
   * due istanze girano insieme, ed e' l'unica strada sicura.
   */
  const profili = new Map<string, { full_name?: string | null; email_marketing?: boolean | null }>();
  const idPersone = [...new Set(batch.map((r) => r.user_id))];
  if (idPersone.length > 0) {
    const { data: righeProfilo } = await supa
      .from('profiles')
      .select('id, full_name, email_marketing')
      .in('id', idPersone);
    for (const p of (righeProfilo ?? []) as Array<{ id: string; full_name: string | null; email_marketing: boolean | null }>) {
      profili.set(p.id, p);
    }
  }

  for (const row of batch) {
    const userProfile = profili.get(row.user_id) ?? null;
    // Il nome di battesimo: lo scrive la persona nel proprio profilo, quindi e'
    // testo di un altro, e il template lo filtra prima di metterlo nell'HTML.
    const messaggio = preparaEmailCicloDiVita(row.template, { name: userProfile?.full_name?.split(' ')[0] });
    if (!messaggio) {
      skipped++;
      await annullaRiga(supa, row.id);
      continue;
    }
    // welcome/tutorial = onboarding relazionale → partono sempre. Gli altri
    // (promo / re-engagement / win-back) sono marketing → solo con consenso.
    const isMarketing = !TRANSACTIONAL_TEMPLATES.has(row.template);
    if (isMarketing && !userProfile?.email_marketing) {
      skipped++;
      await annullaRiga(supa, row.id);
      continue;
    }
    const { data: authUser } = await supa.auth.admin.getUserById(row.user_id).catch(() => ({ data: null as any }));
    const email = authUser?.user?.email;
    if (!email) {
      skipped++;
      await annullaRiga(supa, row.id);
      continue;
    }
    const res = await sendEmail({
      to: email,
      subject: messaggio.subject,
      html: messaggio.html,
      text: messaggio.text,
      tags: [{ name: 'template', value: row.template }],
    });
    if ('ok' in res && res.ok) {
      sent++;
      // 22/8/2026 — L'ESITO DI QUESTA SCRITTURA NON SI GUARDAVA.
      // L'email e' USCITA. Se il registro non riesce a scriverlo, la riga resta
      // «da inviare» e il giro dopo la manda un'altra volta: la persona la
      // riceve due volte e noi non sappiamo nemmeno perche'. Non si ripara da
      // qui — il messaggio e' partito — ma va visto, non ingoiato.
      const { error: errSegno } = await supa
        .from('email_queue')
        .update({ sent_at: new Date().toISOString() }).eq('id', row.id);
      if (errSegno) {
        logger.error('[cron] EMAIL USCITA E NON REGISTRATA: il prossimo giro la rimanda', {
          id: row.id, template: row.template, message: errSegno.message,
        });
      }
    } else {
      errors++;
      // 182 — Prima si rilasciava il claim e basta: nessun contatore, nessuna
      // resa. Un indirizzo che rimbalza veniva ritentato per sempre, e ogni
      // rimbalzo abbassa la reputazione del mittente — cioè fa finire nello
      // spam anche le conferme d'ordine di tutti gli altri.
      // Ora: si conta il tentativo, si scrive il motivo, si rimanda in avanti
      // con attesa crescente, e al quinto si smette e si dichiara annullata.
      const tentativi = (typeof row.attempts === 'number' ? row.attempts : 0) + 1;
      const motivo = 'error' in res && res.error ? String(res.error).slice(0, 500) : 'invio fallito';
      const MASSIMO = 5;
      if (tentativi >= MASSIMO) {
        await supa.from('email_queue').update({
          claimed_at: null,
          attempts: tentativi,
          last_error: motivo,
          cancelled_at: new Date().toISOString(),
        }).eq('id', row.id);
      } else {
        // Attesa crescente: 5, 25, 125, 625 minuti.
        const rinvioMin = 5 ** tentativi;
        await supa.from('email_queue').update({
          claimed_at: null,
          attempts: tentativi,
          last_error: motivo,
          send_at: new Date(Date.now() + rinvioMin * 60_000).toISOString(),
        }).eq('id', row.id);
      }
    }
  }
  return NextResponse.json({ ok: true, sent, skipped, errors, total: batch.length });
}

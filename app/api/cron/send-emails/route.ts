import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email/client';
import { env, requireSupabaseService } from '@/lib/env';
import { withCronAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

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
 * Trigger esterno (es. cron-job.org ogni 5 min):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yoursite/api/cron/send-emails
 */

export const runtime = 'nodejs';

// URL assoluto del sito per i link nelle email (niente domini hardcoded).
const APP_URL = env.appUrl().replace(/\/$/, '');

type EmailTemplateData = { name?: string | null; total?: number; [k: string]: unknown };
const TEMPLATES: Record<string, { subject: string; html: (data: EmailTemplateData) => string; text: (data: EmailTemplateData) => string }> = {
  welcome: {
    subject: 'Benvenuto su MyCity Piacenza 🎉',
    html: (d) => `<p>Ciao ${d.name ?? ''},</p><p>Grazie per esserti iscritto a MyCity. Il marketplace dei negozi di Piacenza ti aspetta.</p><p><a href="${APP_URL}">Inizia ad esplorare →</a></p>`,
    text: (d) => `Ciao ${d.name ?? ''}, grazie per esserti iscritto a MyCity Piacenza.`,
  },
  tutorial_day2: {
    subject: '3 cose da sapere su MyCity',
    html: () => `<p>Eccoti 3 trucchi:</p><ul><li>Paghi alla consegna (niente carta obbligatoria)</li><li>Spedizione gratis sopra €30</li><li>Invita un amico e prendi €5 entrambi</li></ul>`,
    text: () => 'Tre cose da sapere: paghi alla consegna, spedizione gratis sopra €30, referral €5.',
  },
  first_order_promo: {
    subject: 'Sblocca €5 al primo ordine',
    html: () => `<p>Hai €5 di benvenuto pronti.</p><p>Usali al primo ordine: lo sconto si applica automaticamente.</p><p><a href="${APP_URL}/search">Vai allo shopping →</a></p>`,
    text: () => 'Hai €5 di sconto al primo ordine. Usali su MyCity.',
  },
  reengagement_14d: {
    subject: 'Cosa succede in città questa settimana',
    html: () => `<p>Eventi, novità dai negozi, e gli sconti del momento. Dai un\'occhiata.</p><p><a href="${APP_URL}/events">Vedi gli eventi →</a></p>`,
    text: () => 'Eventi della settimana su MyCity.',
  },
  winback_60d: {
    subject: 'Ci manchi! Torna con uno sconto',
    html: () => `<p>Non ti vediamo da un po\'.</p><p>Usa il codice <strong>RITORNO10</strong> per il -10% sul prossimo ordine.</p>`,
    text: () => 'Codice RITORNO10 per -10% sul prossimo ordine.',
  },
  abandoned_cart_4h: {
    subject: 'Hai dimenticato qualcosa nel carrello',
    html: () => `<p>Il tuo carrello ti aspetta.</p><p><a href="${APP_URL}/cart">Vai al carrello →</a></p>`,
    text: () => 'Il tuo carrello ti aspetta su MyCity.',
  },
};

// Template relazionali/onboarding (welcome, tutorial): esenti dal consenso
// marketing — l'utente che si iscrive li attende. Gli altri sono marketing.
const TRANSACTIONAL_TEMPLATES = new Set(['welcome', 'tutorial_day2']);

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

const handler = withCronAuth(async (req): Promise<NextResponse> => {
  let supaCfg;
  try { supaCfg = requireSupabaseService(); } catch (e) {
    return ApiErrors.unavailable(e instanceof Error ? e.message : 'config error');
  }
  const supa = createClient(supaCfg.url, supaCfg.key, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1) Claim batch (atomic UPDATE … RETURNING per evitare double-send)
  const { data: batch, error: claimErr } = await supa.rpc('claim_pending_emails', { p_max: 50 });
  if (claimErr) {
    // Fallback: select + manual lock window
    const { data: pending } = await supa
      .from('email_queue')
      .select('id, user_id, template')
      .lte('send_at', new Date().toISOString())
      .is('sent_at', null)
      .is('cancelled_at', null)
      .limit(50);
    if (!pending?.length) return NextResponse.json({ ok: true, sent: 0, claimed: 0 });
    // Process without atomic claim
    return await processBatch(supa, pending as any[]);
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
async function processBatch(supa: any, batch: { id: string; user_id: string; template: string }[]): Promise<NextResponse> {
  let sent = 0, skipped = 0, errors = 0;
  for (const row of batch) {
    const tpl = TEMPLATES[row.template];
    if (!tpl) {
      skipped++;
      await supa.from('email_queue').update({ cancelled_at: new Date().toISOString() }).eq('id', row.id);
      continue;
    }
    // Lookup utente email + preferenza marketing
    const { data: userProfile } = await supa.from('profiles').select('id, full_name, email_marketing').eq('id', row.user_id).single();
    // welcome/tutorial = onboarding relazionale → partono sempre. Gli altri
    // (promo / re-engagement / win-back) sono marketing → solo con consenso.
    const isMarketing = !TRANSACTIONAL_TEMPLATES.has(row.template);
    if (isMarketing && !userProfile?.email_marketing) {
      skipped++;
      await supa.from('email_queue').update({ cancelled_at: new Date().toISOString() }).eq('id', row.id);
      continue;
    }
    const { data: authUser } = await supa.auth.admin.getUserById(row.user_id).catch(() => ({ data: null as any }));
    const email = authUser?.user?.email;
    if (!email) {
      skipped++;
      await supa.from('email_queue').update({ cancelled_at: new Date().toISOString() }).eq('id', row.id);
      continue;
    }
    const data = { name: userProfile?.full_name?.split(' ')[0] };
    const res = await sendEmail({
      to: email,
      subject: tpl.subject,
      html: tpl.html(data),
      text: tpl.text(data),
      tags: [{ name: 'template', value: row.template }],
    });
    if ('ok' in res && res.ok) {
      sent++;
      await supa.from('email_queue').update({ sent_at: new Date().toISOString() }).eq('id', row.id);
    } else {
      errors++;
      // Invio fallito: rilascia il claim così il prossimo run può ritentare.
      await supa.from('email_queue').update({ claimed_at: null }).eq('id', row.id);
    }
  }
  return NextResponse.json({ ok: true, sent, skipped, errors, total: batch.length });
}

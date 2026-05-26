import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email/client';
import { requireSupabaseService } from '@/lib/env';

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
 * Trigger esterno (cron-job.org ogni ora):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yoursite/api/cron/abandoned-carts
 */

export const runtime = 'nodejs';

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) return jsonError(503, 'CRON_SECRET non configurato.');

  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
  if (bearer !== expectedSecret) return jsonError(401, 'Non autorizzato');

  let supaCfg;
  try { supaCfg = requireSupabaseService(); } catch (e: any) { return jsonError(503, e.message); }
  const supa = createClient(supaCfg.url, supaCfg.key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await supa.rpc('list_abandoned_carts_to_recover', { min_hours: 4 });
  if (error) return jsonError(500, error.message);

  const candidates = (data ?? []) as Array<{ user_id: string; email: string; full_name: string | null; cart_data: any; cart_total: number }>;
  let sent = 0, errors = 0;

  for (const c of candidates) {
    const itemsList = Array.isArray(c.cart_data)
      ? (c.cart_data as any[]).slice(0, 5).map((i) => `<li>${i.quantity ?? 1}× ${i.name ?? 'Prodotto'}</li>`).join('')
      : '';
    const first = c.full_name?.split(' ')[0] ?? '';
    const res = await sendEmail({
      to: c.email,
      subject: 'Hai dimenticato qualcosa nel carrello',
      html: `<p>Ciao ${first},</p>
             <p>Il tuo carrello (€${Number(c.cart_total).toFixed(2)}) ti aspetta.</p>
             ${itemsList ? `<ul>${itemsList}</ul>` : ''}
             <p><a href="https://mycity-marketplace.com/cart" style="background:#C0492C;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Completa l&apos;acquisto →</a></p>
             <p style="font-size:12px;color:#888">Se hai cambiato idea, ignora questa email. Non ti scriveremo più per questo carrello.</p>`,
      text: `Il tuo carrello ti aspetta. Totale €${Number(c.cart_total).toFixed(2)}. Vai su mycity-marketplace.com/cart.`,
      tags: [{ name: 'template', value: 'abandoned_cart_4h' }],
    });
    if ('ok' in res && res.ok) {
      sent++;
      await supa.rpc('mark_abandoned_cart_email_sent', { p_user: c.user_id });
    } else {
      errors++;
    }
  }

  return NextResponse.json({ ok: true, sent, errors, candidates: candidates.length });
}

export const POST = handle;
export const GET = handle;

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { cancellaAccount } from '@/lib/account/cancellazione';
import { withAdminAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * Cancellazione di un account da parte di un admin.
 * Pipeline = a /api/account/delete ma:
 *  - target preso da [id] in URL (non dal token)
 *  - chiamante deve essere admin (verificato via DB)
 *  - admin non puo' cancellare se stesso da qui (anti lock-out)
 *  - errori dettagliati nel response (utile per debug, e' admin)
 */



async function handler(_req: NextRequest, caller: { id: string }, { params }: { params: { id: string } }) {
  const targetId = params.id;

  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseService) return ApiErrors.unavailable();
  if (!targetId || targetId.length < 10) return ApiErrors.invalidRequest('ID utente non valido.');

  const admin = createClient(supabaseUrl, supabaseService, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Anti lock-out
  if (caller.id === targetId) {
    return ApiErrors.invalidRequest('Non puoi eliminare il tuo stesso account da qui. Usa Impostazioni → Elimina account.');
  }

  // Esistenza target
  const { data: targetProfile } = await admin
    .from('profiles')
    .select('id, role, full_name, store_name')
    .eq('id', targetId)
    .single();
  if (!targetProfile) return ApiErrors.notFound('Utente non trovato.');

  // #178 — Una pipeline sola, la stessa del cron. Prima questa strada
  // anonimizzava il profilo e basta: la carta d'identita' e il selfie
  // restavano nello storage, le recensioni col nome dentro restavano, e la
  // newsletter continuava ad arrivare. Due strade per la stessa promessa —
  // «i tuoi dati vengono cancellati» — e una delle due non la manteneva.
  const esito = await cancellaAccount(admin, targetId);
  if (!esito.ok) {
    logger.error('admin delete: cancellazione fallita', { targetId, errore: esito.errore });
    return NextResponse.json({ error: esito.errore }, { status: 500 });
  }

  await writeAudit({
    actorId: caller.id,
    action: 'user.delete',
    targetTable: 'profiles',
    targetId: targetId,
    metadata: { role: targetProfile.role, name: targetProfile.store_name ?? targetProfile.full_name },
  });

  return NextResponse.json({
    ok: true,
    deleted: { id: targetId, role: targetProfile.role, name: targetProfile.store_name ?? targetProfile.full_name },
  });
}

// Rate limit destructive: 20 cancellazioni / ora per admin (anti-abuse + audit trail)
export const DELETE = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  withAdminAuthRateLimit({ name: 'admin-delete-user', max: 20, windowMs: 60 * 60_000 }, async ({ user }) => handler(req, user, { params: await ctx.params }))(req);

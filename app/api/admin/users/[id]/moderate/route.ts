import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit, type AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * Moderazione utente (approva/rifiuta/sospendi/riattiva) SERVER-SIDE, così ogni
 * azione finisce nell'audit log (`writeAudit`). Prima questi update erano fatti
 * dal client direttamente su `profiles`: funzionavano (via RLS admin) ma non
 * lasciavano alcuna traccia → il pannello "Audit log" restava vuoto.
 */
const Body = z.object({
  action: z.enum(['approve', 'reject', 'reactivate', 'suspend']),
  reason: z.string().max(500).optional(),
});

type Action = z.infer<typeof Body>['action'];

function buildModeration(action: Action, reason: string | undefined, adminId: string): {
  patch: Record<string, unknown>;
  note: { title: string; body: string; link: string };
  audit: AuditAction;
} {
  const now = new Date().toISOString();
  switch (action) {
    case 'approve':
      return {
        patch: { approval_status: 'approved', is_approved: true, approved_at: now, approved_by: adminId, rejection_reason: null },
        note: { title: '✅ Negozio approvato', body: 'Il tuo negozio è stato approvato! Ora puoi accedere alla dashboard e pubblicare prodotti.', link: '/seller/dashboard' },
        audit: 'user.approve',
      };
    case 'reject':
      return {
        patch: { approval_status: 'rejected', is_approved: false, rejection_reason: reason },
        note: { title: '❌ Richiesta non approvata', body: `La tua richiesta non è stata approvata. Motivo: ${reason}`, link: '/sell' },
        audit: 'user.reject',
      };
    case 'reactivate':
      return {
        patch: { is_approved: true, approval_status: 'approved', rejection_reason: null, approved_at: now },
        note: { title: '✅ Negozio riattivato', body: 'Il tuo negozio è di nuovo operativo. Puoi tornare a vendere su MyCity.', link: '/seller/dashboard' },
        audit: 'user.reactivate',
      };
    case 'suspend':
      return {
        patch: { is_approved: false, approval_status: 'suspended', rejection_reason: null },
        note: { title: '⏸️ Negozio sospeso', body: 'Il tuo negozio è stato temporaneamente sospeso da un amministratore. Contatta il supporto per chiarimenti.', link: '/contact' },
        audit: 'user.suspend',
      };
  }
}

async function handler(req: NextRequest, user: { id: string }, params: { id: string }): Promise<NextResponse> {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }
  if (body.action === 'reject' && !body.reason?.trim()) {
    return ApiErrors.invalidRequest('Specifica un motivo per il rifiuto.');
  }

  const admin = getAdminSupabase();
  const { data: target } = await admin
    .from('profiles')
    .select('id, role, store_name, full_name')
    .eq('id', params.id)
    .single();
  if (!target) return ApiErrors.notFound('Utente non trovato.');

  const { patch, note, audit } = buildModeration(body.action, body.reason?.trim(), user.id);

  const { error: updErr } = await admin.from('profiles').update(patch).eq('id', params.id);
  if (updErr) return ApiErrors.internal('Aggiornamento fallito.');

  await admin.from('notifications').insert({ user_id: params.id, ...note });

  await writeAudit({
    actorId: user.id,
    action: audit,
    targetTable: 'profiles',
    targetId: params.id,
    metadata: { role: target.role, name: target.store_name ?? target.full_name, reason: body.reason ?? null },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  withAdminAuth(async ({ user }) => handler(req, user, await ctx.params))(req);

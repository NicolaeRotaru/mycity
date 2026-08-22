import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit, type AuditAction } from '@/lib/audit';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

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

/**
 * Anche i fattorini si approvano da qui.
 *
 * Il difetto: il pannello mostrava i pulsanti di approvazione SOLO ai negozi,
 * quindi un fattorino iscritto restava «in attesa» per sempre e nessuno poteva
 * sbloccarlo. Su questo database ce n'era uno fermo dal 25 maggio — ed e' il
 * motivo per cui la bacheca delle consegne era vuota: senza un fattorino
 * approvato non c'e' nessuno che possa prendere un ordine.
 *
 * L'endpoint sapeva gia' farlo: non ha mai avuto un filtro sul ruolo. Mancavano
 * i pulsanti nel pannello, e questi testi, che parlavano solo di negozi — un
 * fattorino approvato si vedeva arrivare «Il tuo negozio e' stato approvato».
 */
const TESTI_PER_RUOLO = {
  rider: {
    approve:    { titolo: '✅ Profilo approvato',   corpo: 'Il tuo profilo fattorino è stato approvato! Ora puoi vedere le consegne disponibili e accettarle.', link: '/rider' },
    reject:     { titolo: '❌ Richiesta non approvata', corpo: 'La tua richiesta come fattorino non è stata approvata.', link: '/contact' },
    reactivate: { titolo: '✅ Profilo riattivato',  corpo: 'Il tuo profilo fattorino è di nuovo attivo. Puoi tornare a fare consegne.', link: '/rider' },
    suspend:    { titolo: '⏸️ Profilo sospeso',     corpo: 'Il tuo profilo fattorino è stato temporaneamente sospeso da un amministratore. Contatta il supporto per chiarimenti.', link: '/contact' },
  },
  seller: {
    approve:    { titolo: '✅ Negozio approvato',   corpo: 'Il tuo negozio è stato approvato! Ora puoi accedere alla dashboard e pubblicare prodotti.', link: '/seller/dashboard' },
    reject:     { titolo: '❌ Richiesta non approvata', corpo: 'La tua richiesta non è stata approvata.', link: '/sell' },
    reactivate: { titolo: '✅ Negozio riattivato',  corpo: 'Il tuo negozio è di nuovo operativo. Puoi tornare a vendere su MyCity.', link: '/seller/dashboard' },
    suspend:    { titolo: '⏸️ Negozio sospeso',     corpo: 'Il tuo negozio è stato temporaneamente sospeso da un amministratore. Contatta il supporto per chiarimenti.', link: '/contact' },
  },
} as const;

function buildModeration(action: Action, reason: string | undefined, adminId: string, ruolo: string): {
  patch: Record<string, unknown>;
  note: { title: string; body: string; link: string };
  audit: AuditAction;
} {
  const now = new Date().toISOString();
  const testi = ruolo === 'rider' ? TESTI_PER_RUOLO.rider : TESTI_PER_RUOLO.seller;
  const scheda = testi[action];
  const note = {
    title: scheda.titolo,
    body: action === 'reject' && reason ? `${scheda.corpo} Motivo: ${reason}` : scheda.corpo,
    link: scheda.link,
  };

  switch (action) {
    case 'approve':
      return {
        patch: { approval_status: 'approved', is_approved: true, approved_at: now, approved_by: adminId, rejection_reason: null },
        note,
        audit: 'user.approve',
      };
    case 'reject':
      return {
        patch: { approval_status: 'rejected', is_approved: false, rejection_reason: reason },
        note,
        audit: 'user.reject',
      };
    case 'reactivate':
      return {
        patch: { is_approved: true, approval_status: 'approved', rejection_reason: null, approved_at: now },
        note,
        audit: 'user.reactivate',
      };
    case 'suspend':
      return {
        patch: { is_approved: false, approval_status: 'suspended', rejection_reason: null },
        note,
        audit: 'user.suspend',
      };
  }
}

async function handler(req: NextRequest, user: { id: string }, params: { id: string }): Promise<NextResponse> {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
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

  const { patch, note, audit } = buildModeration(body.action, body.reason?.trim(), user.id, target.role ?? 'seller');

  const { error: updErr } = await admin.from('profiles').update(patch).eq('id', params.id);
  if (updErr) return ApiErrors.internal('Aggiornamento fallito.');

  await admin.from('notifications').insert({ category: 'system', user_id: params.id, ...note });

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

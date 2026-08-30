import { NextResponse, type NextRequest } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { getClientIp } from '@/lib/rate-limit';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * I dati di verifica identità di UN utente, chiesti apposta e messi a verbale.
 *
 * Il difetto (#81). Il pannello utenti caricava in blocco il codice fiscale e la
 * partita IVA di TUTTI: bastava aprire la pagina — anche solo per cercare un
 * negozio — e nel browser dell'amministratore finivano i documenti di ogni
 * persona iscritta. La privacy dichiara che quei dati si vedono «quando serve»,
 * e nessuna lettura lasciava traccia: nel registro non risultava mai nessuno che
 * li avesse guardati.
 *
 * Ora si chiedono per un utente alla volta, quando si apre la sua scheda, e ogni
 * lettura scrive una riga nel registro: chi, quando, di chi.
 */
async function handler(req: NextRequest, admin_user: { id: string }, params: { id: string }) {
  const targetId = params.id;
  if (!/^[0-9a-f-]{36}$/i.test(targetId)) return ApiErrors.invalidRequest('ID non valido');

  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from('profiles')
    .select('id, legal_fiscal_code, business_vat_number')
    .eq('id', targetId)
    .maybeSingle();

  if (error) return ApiErrors.internal('Lettura non riuscita.');
  if (!data) return ApiErrors.notFound('Utente non trovato.');

  await writeAudit({
    actorId: admin_user.id,
    action: 'kyc.approve', // l'elenco delle azioni non ha «lettura»: si usa la voce KYC con l'esito nei dettagli
    targetTable: 'profiles',
    targetId,
    metadata: { evento: 'lettura_dati_identita', campi: ['legal_fiscal_code', 'business_vat_number'] },
    // 27/8/2026 (R024) — Qui si salvava la catena `x-forwarded-for` INTERA,
    // pezzi falsificabili compresi: un registro degli accessi ai dati di
    // identita' che nessuno puo' usare come prova.
    ip: getClientIp(req),
    userAgent: req.headers.get('user-agent') ?? undefined,
  });

  return NextResponse.json({
    legal_fiscal_code: data.legal_fiscal_code ?? null,
    business_vat_number: data.business_vat_number ?? null,
  });
}

export const GET = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  withAdminAuth(async ({ user }) => handler(req, user, await ctx.params))(req);

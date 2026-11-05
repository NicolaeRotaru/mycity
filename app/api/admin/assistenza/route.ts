import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { accountAssistenza } from '@/lib/admin/account-assistenza';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/assistenza — le chat di assistenza, per OGNI amministratore.
 *
 * Le richieste d'aiuto si intestano all'account Assistenza (il primo admin).
 * La pagina filtrava con l'id di chi era collegato: ogni altro admin vedeva
 * «Nessuna richiesta di assistenza» anche con richieste in attesa. Le regole
 * per riga di `conversations` mostrano una chat solo ai due partecipanti,
 * quindi la lista la legge il server, e la rotta dice chi è l'Assistenza.
 * Solo admin (withAdminAuth).
 */
export const GET = withAdminAuth(async ({ user }) => {
  const admin = getAdminSupabase();
  let support: { id: string } | null;
  try {
    support = await accountAssistenza(admin);
  } catch (e) {
    logger.error(e, { context: 'admin-assistenza' });
    return ApiErrors.unavailable('Non riesco a leggere l’account Assistenza');
  }
  if (!support) return apiSuccess({ supportId: null, sonoIo: false, conversazioni: [] });
  const { data, error } = await admin
    .from('conversations')
    .select(`
      id, last_message_at, last_message_preview, seller_unread_count,
      buyer:profiles!conversations_buyer_id_fkey ( full_name, store_name )
    `)
    .eq('seller_id', support.id)
    .order('last_message_at', { ascending: false })
    .limit(100);
  if (error) return ApiErrors.internal('Non riesco a leggere le chat di assistenza');
  return apiSuccess({ supportId: support.id, sonoIo: support.id === user.id, conversazioni: data ?? [] });
});

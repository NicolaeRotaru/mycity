import type { getAdminSupabase } from '@/lib/supabase/server';

/**
 * L'account Assistenza: il primo admin (fonte di verità nel DB, no hardcode).
 * Una funzione sola per chi apre la chat (/api/support/conversation) e per il
 * pannello che la mostra agli amministratori (/api/admin/assistenza): se un
 * giorno la regola cambia, cambia per tutti.
 *
 * Un guasto del database LANCIA: «non sono riuscita a chiedere» non è «non c'è
 * nessun admin», e scambiarli faceva ricordare il guasto come una risposta.
 */
export async function accountAssistenza(admin: ReturnType<typeof getAdminSupabase>): Promise<{ id: string } | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`account Assistenza non letto: ${error.code ?? ''} ${error.message}`, { cause: error });
  return (data as { id: string } | null) ?? null;
}

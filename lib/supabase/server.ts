import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { requireSupabasePublic, requireSupabaseService } from '@/lib/env';

/**
 * Client Supabase server-side che usa i cookie della richiesta corrente.
 * Da chiamare dentro Server Components, Server Actions o Route Handlers.
 * Rispetta RLS perché viaggia con il JWT dell'utente.
 */
export function getServerSupabase() {
  const { url, key } = requireSupabasePublic();
  const cookieStore = cookies();
  return createServerClient(url, key, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // In Server Components la mutation dei cookie può fallire: ignora,
          // il middleware si occupa del refresh.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: '', ...options });
        } catch {
          /* idem sopra */
        }
      },
    },
  });
}

/**
 * Client admin con service role. Bypassa RLS — usarlo SOLO per operazioni
 * fidate (cancellazione utente, payout, riconciliazione, webhook handler).
 * MAI esporre risultati grezzi al client.
 */
export function getAdminSupabase() {
  const { url, key } = requireSupabaseService();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Recupera l'utente loggato dalla richiesta corrente. Restituisce null se
 * non c'è sessione. Usabile in Server Components e Route Handlers.
 */
export async function getCurrentUser() {
  try {
    const supa = getServerSupabase();
    const { data, error } = await supa.auth.getUser();
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

/**
 * Recupera utente + profilo (role, is_approved, ecc.). Usato dai layout
 * delle aree protette (admin/seller/rider).
 */
export async function getCurrentUserWithProfile() {
  const user = await getCurrentUser();
  if (!user) return null;
  const supa = getServerSupabase();
  const { data: profile } = await supa
    .from('profiles')
    .select('id, role, is_approved, approval_status, full_name')
    .eq('id', user.id)
    .single();
  return { user, profile };
}

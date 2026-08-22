import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { requireSupabasePublic, requireSupabaseService } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Client Supabase server-side che usa i cookie della richiesta corrente.
 * Da chiamare dentro Server Components, Server Actions o Route Handlers.
 * Rispetta RLS perché viaggia con il JWT dell'utente.
 */
export async function getServerSupabase() {
  const { url, key } = requireSupabasePublic();
  // Next 15: cookies() è asincrono.
  const cookieStore = await cookies();
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
function creaClientAmministrativo() {
  const { url, key } = requireSupabaseService();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let _admin: ReturnType<typeof creaClientAmministrativo> | null = null;

export function getAdminSupabase() {
  // #245 — Si riusa, come si fa gia' per Stripe. Prima ne nasceva uno nuovo a
  // ogni richiesta: ogni client porta con se' la sua coda di connessioni e i
  // suoi timer, e la sola creazione costa su ogni chiamata di API. Il client
  // amministrativo non porta dentro nessuna sessione, quindi tenerlo da parte
  // non mescola i dati di due persone: e' proprio la ragione per cui NON si
  // puo' fare lo stesso con getServerSupabase(), che invece la sessione ce
  // l'ha.
  if (_admin) return _admin;
  _admin = creaClientAmministrativo();
  return _admin;
}

/**
 * 22/8/2026 — «NON C'È NESSUNO» E «NON SONO RIUSCITA A CHIEDERE» NON SONO LA
 * STESSA COSA.
 *
 * Questa funzione restituiva `null` per qualunque guasto, comprese le
 * variabili Supabase mancanti — che fanno lanciare `requireSupabasePublic()`.
 * Con `null`, chi chiamava rispondeva 401 «Autenticazione richiesta»: a chi
 * era regolarmente loggato veniva detto di accedere, e nei log non restava
 * niente. Venti righe più sotto, lo stesso guasto sul caricamento del profilo
 * rispondeva già 503 «Auth non configurato», che è la risposta giusta.
 *
 * Ora il guasto si distingue: si annota e si rilancia come `AuthNonDisponibile`,
 * così chi chiama può rispondere 503. «Nessuna sessione» resta `null`.
 */
export class AuthNonDisponibile extends Error {
  constructor(readonly causa: unknown) {
    super('Auth non disponibile: non è stato possibile interrogare Supabase');
    this.name = 'AuthNonDisponibile';
  }
}

/**
 * Recupera l'utente loggato dalla richiesta corrente. Restituisce null se
 * non c'è sessione. Usabile in Server Components e Route Handlers.
 *
 * Lancia `AuthNonDisponibile` se la domanda non si è potuta fare — non è la
 * stessa cosa di «non c'è nessuno», e non va confusa con quella.
 */
export async function getCurrentUser() {
  let supa: Awaited<ReturnType<typeof getServerSupabase>>;
  try {
    supa = await getServerSupabase();
  } catch (e) {
    logger.error('[auth] client server non creabile: configurazione incompleta', e);
    throw new AuthNonDisponibile(e);
  }
  try {
    const { data, error } = await supa.auth.getUser();
    // Un token scaduto o assente è «nessuna sessione», non un guasto: quello
    // Supabase lo dice con un errore di autenticazione, non con una rete rotta.
    if (error || !data?.user) return null;
    return data.user;
  } catch (e) {
    logger.error('[auth] interrogazione della sessione fallita', e);
    throw new AuthNonDisponibile(e);
  }
}

/**
 * Recupera utente + profilo (role, is_approved, ecc.). Usato dai layout
 * delle aree protette (admin/seller/rider).
 */
export async function getCurrentUserWithProfile() {
  const user = await getCurrentUser();
  if (!user) return null;
  const supa = await getServerSupabase();
  const { data: profile } = await supa
    .from('profiles')
    .select('id, role, is_approved, approval_status, full_name')
    .eq('id', user.id)
    .single();
  return { user, profile };
}

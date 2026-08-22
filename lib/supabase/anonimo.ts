import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireSupabasePublic } from '@/lib/env';

/**
 * 22/8/2026 — LA FABBRICA UNICA DEL CLIENT ANONIMO PER RICHIESTA.
 *
 * C'erano cinque modi di creare un client Supabase in quattro file. Due di
 * quei cinque facevano la stessa identica cosa — un client anonimo che vive
 * quanto una richiesta, senza sessione salvata — con impostazioni diverse:
 * `lib/supabase/auth-server.ts` passava anche `detectSessionInUrl: false`,
 * `lib/api/middleware.ts` no. E leggevano le variabili in due modi diversi: il
 * secondo, se mancavano, restituiva `null` invece di dire cosa mancava.
 *
 * Due copie della stessa cosa non restano uguali: divergono, e il giorno in
 * cui una delle due si comporta male nessuno sa quale delle due sta guardando.
 * Qui ce n'è una sola, e le variabili le chiede a `requireSupabasePublic()`,
 * che quando mancano LANCIA con il nome esatto di quello che manca.
 *
 * Questo modulo non importa `next/headers`: si può caricare da qualunque
 * contesto server, anche dove il modulo dei cookie non è disponibile.
 */
export function creaClientAnonimo(): SupabaseClient {
  const { url, key } = requireSupabasePublic();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

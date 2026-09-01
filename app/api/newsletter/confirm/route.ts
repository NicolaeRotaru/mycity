import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * Conferma dell'iscrizione alla newsletter: il link che arriva per email.
 *
 * È il momento in cui l'iscrizione diventa attiva. Prima non esisteva: si
 * finiva in lista senza che nessuno avesse verificato di possedere la casella,
 * quindi si poteva iscrivere l'indirizzo di un altro.
 */
export async function GET(request: Request) {
  // 27/8/2026 (R140) — GET PUBBLICO NUDO CHE SCRIVE SUL DATABASE. Ogni
  // chiamata, anche con un gettone inventato, faceva partire un UPDATE su
  // `newsletter_subscribers`: un client solo poteva tenere occupato il
  // database con richieste anonime. Il conto e' largo — un link di conferma si
  // clicca una volta, al massimo qualche volta se la pagina si ricarica.
  const freno = await rateLimitAsync({
    key: `newsletter-confirm:${getClientIp(request)}`,
    max: 30,
    windowMs: 10 * 60_000,
  });

  const token = new URL(request.url).searchParams.get('token') ?? '';
  // NEXT_PUBLIC_SITE_URL non esiste in questo progetto: valeva stringa vuota, e un
  // indirizzo relativo fa lanciare NextResponse.redirect. Il punto unico e env.appUrl().
  const base = env.appUrl();

  // Sopra soglia si manda alla stessa pagina del link non valido: chi abusa non
  // costa una scrittura, e chi ha cliccato davvero vede una pagina, non un errore.
  if (!freno.allowed) {
    return NextResponse.redirect(`${base}/?newsletter=link-non-valido`);
  }

  if (!token || token.length > 200) {
    return NextResponse.redirect(`${base}/?newsletter=link-non-valido`);
  }

  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from('newsletter_subscribers')
    .update({ active: true, confirmed_at: new Date().toISOString(), confirm_token: null })
    .eq('confirm_token', token)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    return NextResponse.redirect(`${base}/?newsletter=link-non-valido`);
  }
  return NextResponse.redirect(`${base}/?newsletter=confermata`);
}

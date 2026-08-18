import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * Conferma dell'iscrizione alla newsletter: il link che arriva per email.
 *
 * È il momento in cui l'iscrizione diventa attiva. Prima non esisteva: si
 * finiva in lista senza che nessuno avesse verificato di possedere la casella,
 * quindi si poteva iscrivere l'indirizzo di un altro.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  // NEXT_PUBLIC_SITE_URL non esiste in questo progetto: valeva stringa vuota, e un
  // indirizzo relativo fa lanciare NextResponse.redirect. Il punto unico e env.appUrl().
  const base = env.appUrl();

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

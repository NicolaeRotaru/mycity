import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { verificaDisiscrizione } from '@/lib/email/unsubscribe';

export const runtime = 'nodejs';

/**
 * Disiscrizione con un clic, senza accedere. È il link nel footer delle email.
 * Il token è firmato: vale solo per quell'indirizzo e per quell'ambito.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const dati = verificaDisiscrizione(token);

  if (!dati) {
    return NextResponse.redirect(`${base}/?disiscrizione=link-non-valido`);
  }

  const admin = getAdminSupabase();
  const adesso = new Date().toISOString();

  if (dati.ambito === 'newsletter') {
    await admin
      .from('newsletter_subscribers')
      .update({ active: false, unsubscribed_at: adesso })
      .eq('email', dati.email);
  }

  // Vale per entrambi gli ambiti: chi chiede di smettere smette anche di
  // ricevere le email commerciali legate al suo profilo.
  await admin
    .from('profiles')
    .update({ email_marketing: false, notif_promos: false })
    .eq('email', dati.email);

  return NextResponse.redirect(`${base}/?disiscrizione=fatta`);
}

/** Alcuni client di posta chiamano il link in POST (List-Unsubscribe-Post). */
export async function POST(request: Request) {
  return GET(request);
}

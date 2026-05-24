import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { createConnectOnboardingLink, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * Avvia onboarding Stripe Connect Express per il seller corrente.
 * Crea un Connect account (o riusa quello esistente) e ritorna l'URL
 * dell'account link Stripe (KYC + IBAN + accordo TOS).
 *
 * Da chiamare DOPO che il seller ha completato il KYC su MyCity
 * (approval_status = 'approved').
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe non configurato' }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user?.email) {
    return NextResponse.json({ error: 'Autenticazione richiesta.' }, { status: 401 });
  }

  const supa = getServerSupabase();
  const { data: profile, error: pErr } = await supa
    .from('profiles')
    .select('role, approval_status, stripe_account_id, store_name')
    .eq('id', user.id)
    .single();
  if (pErr || !profile) {
    return NextResponse.json({ error: 'Profilo non trovato.' }, { status: 404 });
  }
  if (profile.role !== 'seller') {
    return NextResponse.json({ error: 'Solo i venditori possono attivare i pagamenti.' }, { status: 403 });
  }
  if (profile.approval_status !== 'approved') {
    return NextResponse.json(
      { error: 'Completa prima la verifica KYC del negozio.' },
      { status: 403 },
    );
  }

  try {
    const { accountId, url } = await createConnectOnboardingLink({
      sellerEmail: user.email,
      sellerId: user.id,
      existingAccount: profile.stripe_account_id ?? null,
      returnUrl: `${env.appUrl()}/seller/dashboard?stripe=connected`,
      refreshUrl: `${env.appUrl()}/seller/dashboard?stripe=refresh`,
    });

    // Salva account_id (admin client per bypass RLS)
    if (accountId !== profile.stripe_account_id) {
      const admin = getAdminSupabase();
      await admin
        .from('profiles')
        .update({ stripe_account_id: accountId })
        .eq('id', user.id);
    }

    return NextResponse.json({ url }, { status: 200 });
  } catch (err: any) {
    console.error('[stripe] connect onboarding failed', err);
    return NextResponse.json({ error: 'Errore Stripe' }, { status: 500 });
  }
}

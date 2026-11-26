import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { createConnectOnboardingLink, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { ContoNonSalvato, salvaIlConto } from '@/lib/stripe/salva-conto';
import { withSellerAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/** Il conto di prima che la chiave di prova dell'anteprima non conosce: cosa fare, in chiaro. */
const CONTO_SCONOSCIUTO_IN_ANTEPRIMA =
  'In questa anteprima Stripe usa le chiavi di prova e non riconosce il conto salvato sul tuo profilo. Se stai provando con dati di prova, togli il conto dal profilo e riprova.';

/**
 * Avvia onboarding Stripe Connect Express per il seller corrente.
 * Crea un Connect account (o riusa quello esistente) e ritorna l'URL
 * dell'account link Stripe (KYC + IBAN + accordo TOS).
 *
 * Da chiamare DOPO che il seller ha completato il KYC su MyCity
 * (approval_status = 'approved').
 */
// Rate limit: 10 / ora per seller (anti-abuse Stripe onboarding)
export const POST = withSellerAuthRateLimit({ name: 'stripe-onboarding', max: 10, windowMs: 60 * 60_000 }, async ({ user }): Promise<NextResponse> => {
  if (!isStripeConfigured()) return ApiErrors.unavailable('Stripe non configurato');
  if (!user.email) return ApiErrors.unauthorized();

  const supa = await getServerSupabase();
  const { data: profile, error: pErr } = await supa
    .from('profiles')
    .select('approval_status, stripe_account_id, store_name')
    .eq('id', user.id)
    .single();
  if (pErr || !profile) return ApiErrors.notFound('Profilo non trovato.');
  if (profile.approval_status !== 'approved') {
    return ApiErrors.forbidden('Completa prima la verifica KYC del negozio.');
  }

  try {
    const { url } = await createConnectOnboardingLink({
      sellerEmail: user.email,
      sellerId: user.id,
      existingAccount: profile.stripe_account_id ?? null,
      returnUrl: `${env.appUrl()}/seller/dashboard?stripe=connected`,
      refreshUrl: `${env.appUrl()}/seller/dashboard?stripe=refresh`,
      ruolo: 'venditore',
      salvaConto: (id) => salvaIlConto(user.id, id),
    });

    return NextResponse.json({ url }, { status: 200 });
  } catch (err) {
    // 5/11/2026 — l'id del conto non si e' salvato: non si manda a Stripe.
    if (err instanceof ContoNonSalvato) return ApiErrors.unavailable(err.message);
    // 26/11/2026 — In anteprima, con la chiave di prova, il conto salvato sul profilo non esiste
    // per Stripe (lib/stripe/client.ts): si dice alla persona cosa fare, invece del solo
    // «Errore Stripe». L'id del conto resta solo nei registri.
    if ((err as { name?: unknown } | null)?.name === 'ContoSconosciutoAllaChiaveDiProva') {
      logger.warn('[stripe] connect onboarding: conto del profilo sconosciuto alla chiave di prova', err);
      return ApiErrors.conflict(CONTO_SCONOSCIUTO_IN_ANTEPRIMA);
    }
    logger.error('[stripe] connect onboarding failed', err);
    return ApiErrors.internal('Errore Stripe');
  }
});

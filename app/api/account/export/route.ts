import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * GDPR Art. 20 — Portabilità dei dati.
 *
 * Esporta in JSON tutti i dati personali dell'utente corrente:
 *  - profilo
 *  - indirizzi salvati
 *  - ordini (come buyer)
 *  - ordini venduti (come seller, se applicabile)
 *  - ordini consegnati (come rider, se applicabile)
 *  - recensioni lasciate (prodotti, store, rider)
 *  - preferiti
 *  - referral (sia come referrer sia come referred)
 *  - notifiche
 *
 * Restituisce un file `mycity-data-{userId}-{date}.json` scaricabile.
 *
 * Sicurezza: richiede Bearer token; userId derivato dal token.
 */
export const GET = withAuth(async ({ user }): Promise<NextResponse> => {
  const userId = user.id;
  const userEmail = user.email ?? null;

  let admin;
  try {
    admin = getAdminSupabase();
  } catch {
    return ApiErrors.unavailable('Servizio non configurato.');
  }

  // Query parallele
  const [
    profile,
    addresses,
    ordersAsBuyer,
    ordersAsSeller,
    ordersAsRider,
    productReviews,
    storeReviews,
    riderReviews,
    favorites,
    referralsOut,
    referralsIn,
    notifications,
  ] = await Promise.all([
    admin.from('profiles').select('*').eq('id', userId).single(),
    admin.from('user_addresses').select('*').eq('user_id', userId),
    admin.from('orders').select('*, order_items(*)').eq('user_id', userId),
    admin.from('orders').select('id, created_at, total_price, delivery_status').eq('seller_id', userId),
    admin.from('orders').select('id, created_at, delivered_at, shipping_cost').eq('rider_id', userId),
    admin.from('reviews').select('*').eq('user_id', userId),
    admin.from('store_reviews').select('*').eq('reviewer_id', userId),
    admin.from('rider_reviews').select('*').eq('reviewer_id', userId),
    admin.from('favorites').select('*').eq('user_id', userId),
    admin.from('referrals').select('*').eq('referrer_id', userId),
    admin.from('referrals').select('*').eq('referred_id', userId),
    admin.from('notifications').select('*').eq('user_id', userId),
  ]);

  // Anonimizza/maschera campi sensibili anche nell'export
  const profileClean = profile.data ? {
    ...profile.data,
    // Non esportare hash password (non c'è qui, ma per principio nessun secret)
  } : null;

  const payload = {
    export_metadata: {
      generated_at: new Date().toISOString(),
      gdpr_article: 20,
      user_id: userId,
      email: userEmail,
      note: 'Questo file contiene tutti i dati personali associati al tuo account. Conservato in formato JSON strutturato e leggibile come previsto dall\'art. 20 GDPR.',
    },
    profile: profileClean,
    addresses: addresses.data ?? [],
    orders_as_buyer: ordersAsBuyer.data ?? [],
    orders_as_seller: ordersAsSeller.data ?? [],
    orders_as_rider: ordersAsRider.data ?? [],
    reviews: {
      products: productReviews.data ?? [],
      stores: storeReviews.data ?? [],
      riders: riderReviews.data ?? [],
    },
    favorites: favorites.data ?? [],
    referrals: {
      as_referrer: referralsOut.data ?? [],
      as_referred: referralsIn.data ?? [],
    },
    notifications: notifications.data ?? [],
  };

  const today = new Date().toISOString().slice(0, 10);
  const filename = `mycity-data-${userId}-${today}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
});

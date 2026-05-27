import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase, getServerSupabase } from '@/lib/supabase/server';
import { createMultiSellerCheckoutSession, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

const ItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(99),
});

const GroupSchema = z.object({
  sellerId: z.string().uuid(),
  items: z.array(ItemSchema).min(1).max(50),
  shippingCents: z.number().int().nonnegative().default(0),
});

const DeliverySchema = z.object({
  fullName: z.string().min(1).max(200),
  address: z.string().min(1).max(300),
  city: z.string().min(1).max(120),
  zip: z.string().min(1).max(20),
  phone: z.string().min(1).max(40),
  notes: z.string().max(500).optional().nullable(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
});

const B2BSchema = z.object({
  company_name: z.string().min(1).max(200),
  vat_number: z.string().min(1).max(40),
  sdi_code: z.string().max(20).optional().nullable(),
  pec: z.string().email().max(200).optional().nullable(),
}).nullable().optional();

const Body = z.object({
  groups: z.array(GroupSchema).min(1).max(10),
  delivery: DeliverySchema,
  couponCode: z.string().max(40).optional().nullable(),
  /** Importo coupon validato lato client; verrà ri-validato lato server. */
  couponDiscountCents: z.number().int().nonnegative().default(0),
  /** Sconto ritiro in negozio in centesimi (10% sul subtotale del carrello). */
  pickupDiscountCents: z.number().int().nonnegative().default(0),
  pickupInStore: z.boolean().default(false),
  b2b: B2BSchema,
});

/**
 * Crea una Stripe Checkout Session per carrelli single-seller o multi-seller.
 *
 * Pattern (vedi lib/stripe/client.ts):
 *  1. Validiamo prodotti, prezzi e stock leggendo dal DB (mai trust client).
 *  2. Inseriamo una riga in pending_checkouts (record-of-intent).
 *  3. Creiamo la Stripe Session linkata al pending_checkout via
 *     client_reference_id + metadata.pending_checkout_id.
 *  4. Aggiorniamo pending_checkout con stripe_session_id.
 *  5. Il webhook checkout.session.completed legge il pending_checkout
 *     e crea N ordini (uno per seller) con payout_status=HELD.
 *
 * Rate limit: 30 checkout / 10 min per utente.
 */
export const POST = withAuthRateLimit({ name: 'stripe-checkout', max: 30, windowMs: 10 * 60_000 }, async ({ user, req }): Promise<NextResponse> => {
  if (!isStripeConfigured()) {
    return ApiErrors.unavailable('Pagamenti elettronici non disponibili. Usa pagamento alla consegna.');
  }
  if (!user.email) return ApiErrors.unauthorized();
  if (!user.email_confirmed_at) {
    return ApiErrors.forbidden('Conferma la tua email prima di pagare.');
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return ApiErrors.invalidRequest('Dati ordine non validi', e instanceof Error ? e.message : undefined);
  }

  const supa = getServerSupabase();
  const admin = getAdminSupabase();

  // --- 1. Carica tutti i prodotti dal DB in un'unica query.
  const allProductIds = body.groups.flatMap((g) => g.items.map((i) => i.productId));
  const { data: products, error: prodErr } = await supa
    .from('products')
    .select('id, name, price, images, seller_id, stock, status, is_approved')
    .in('id', allProductIds);

  if (prodErr || !products || products.length === 0) {
    return ApiErrors.notFound('Prodotti non trovati.');
  }
  if (products.length !== allProductIds.length) {
    return ApiErrors.invalidRequest('Alcuni prodotti del carrello non sono più disponibili.');
  }

  // --- 2. Carica i seller (per storeName nei line_items Stripe).
  const sellerIds = Array.from(new Set(body.groups.map((g) => g.sellerId)));
  const { data: sellers } = await supa
    .from('profiles')
    .select('id, store_name, full_name')
    .in('id', sellerIds);

  const sellerNameMap = new Map<string, string>();
  for (const s of sellers ?? []) {
    sellerNameMap.set(s.id, s.store_name ?? s.full_name ?? 'Negozio');
  }

  // --- 3. Validazioni per ogni gruppo + costruzione line items per Stripe.
  const stripeGroups: Array<{
    sellerId: string;
    storeName: string;
    items: Array<{ productId: string; name: string; quantity: number; unitAmountCents: number; imageUrl?: string }>;
  }> = [];
  const subtotalPerGroupCents: number[] = [];

  for (const g of body.groups) {
    const stripeItems: Array<{ productId: string; name: string; quantity: number; unitAmountCents: number; imageUrl?: string }> = [];
    let groupSubtotalCents = 0;

    for (const it of g.items) {
      const p = products.find((x) => x.id === it.productId);
      if (!p) {
        return ApiErrors.notFound(`Prodotto ${it.productId} non trovato`);
      }
      if (p.seller_id !== g.sellerId) {
        return ApiErrors.invalidRequest(`Prodotto ${p.name} non appartiene al venditore indicato.`);
      }
      if (!p.is_approved || p.status !== 'available') {
        return ApiErrors.invalidRequest(`Prodotto ${p.name} non disponibile.`);
      }
      if (typeof p.stock === 'number' && p.stock < it.quantity) {
        return NextResponse.json(
          { error: `Stock insufficiente per ${p.name} (${p.stock} disponibili).` },
          { status: 409 },
        );
      }

      const unitCents = Math.round(Number(p.price) * 100);
      const cover = Array.isArray(p.images) ? p.images[0] : null;
      stripeItems.push({
        productId: p.id,
        name: p.name,
        quantity: it.quantity,
        unitAmountCents: unitCents,
        imageUrl: typeof cover === 'string' ? cover : undefined,
      });
      groupSubtotalCents += unitCents * it.quantity;
    }

    stripeGroups.push({
      sellerId: g.sellerId,
      storeName: sellerNameMap.get(g.sellerId) ?? 'Negozio',
      items: stripeItems,
    });
    subtotalPerGroupCents.push(groupSubtotalCents);
  }

  // --- 4. Distribuisci pro-rata coupon + pickup discount per gruppo.
  const grandSubtotalCents = subtotalPerGroupCents.reduce((s, x) => s + x, 0);
  const grandShippingCents = body.groups.reduce((s, g) => s + g.shippingCents, 0);
  const totalDiscountCents = Math.min(
    body.couponDiscountCents + body.pickupDiscountCents,
    Math.max(0, grandSubtotalCents + grandShippingCents - 1), // mai sotto €0,01
  );

  if (grandSubtotalCents <= 0) {
    return ApiErrors.invalidRequest('Importo non valido.');
  }

  const groupPersisted = stripeGroups.map((g, i) => {
    const subtotal = subtotalPerGroupCents[i];
    const shipping = body.groups[i].shippingCents;
    // Quota proporzionale del coupon globale rispetto al subtotale del gruppo
    const portion = grandSubtotalCents > 0 ? subtotal / grandSubtotalCents : 0;
    const couponPortionCents = Math.round(body.couponDiscountCents * portion);
    const pickupPortionCents = Math.round(body.pickupDiscountCents * portion);
    const totalCents = Math.max(0, subtotal + shipping - couponPortionCents - pickupPortionCents);
    return {
      sellerId: g.sellerId,
      storeName: g.storeName,
      items: g.items,
      subtotalCents: subtotal,
      shippingCents: shipping,
      couponPortionCents,
      pickupPortionCents,
      totalCents,
    };
  });

  // L'importo che Stripe addebiterà = somma totalCents pro-rata.
  // Ricostruito per fugare drift da arrotondamento pro-rata.
  const expectedChargeCents = groupPersisted.reduce((s, g) => s + g.totalCents, 0);

  // --- 5. Inserisci pending_checkout (record-of-intent) PRIMA della session Stripe.
  const { data: pending, error: pendErr } = await admin
    .from('pending_checkouts')
    .insert({
      buyer_id: user.id,
      total_cents: expectedChargeCents,
      currency: 'eur',
      groups: groupPersisted,
      coupon_code: body.couponCode ?? null,
      b2b: body.b2b ?? null,
      delivery: {
        full_name: body.delivery.fullName,
        address: body.delivery.address,
        city: body.delivery.city,
        zip: body.delivery.zip,
        phone: body.delivery.phone,
        notes: body.delivery.notes ?? null,
        lat: body.delivery.lat ?? null,
        lng: body.delivery.lng ?? null,
      },
      pickup_in_store: body.pickupInStore,
      status: 'PENDING',
    })
    .select('id')
    .single();

  if (pendErr || !pending) {
    logger.error('[stripe] pending_checkout insert failed', pendErr);
    return ApiErrors.internal('Errore nella preparazione del pagamento.');
  }

  // --- 6. Crea la Stripe Checkout Session.
  const successUrl = `${env.appUrl()}/orders?stripe=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${env.appUrl()}/cart?stripe=canceled`;

  try {
    const session = await createMultiSellerCheckoutSession({
      pendingCheckoutId: pending.id,
      groups: stripeGroups,
      shippingPerGroupCents: body.groups.map((g) => g.shippingCents),
      totalDiscountCents,
      buyerEmail: user.email,
      buyerUserId: user.id,
      successUrl,
      cancelUrl,
    });

    // Salva l'id session su pending_checkout per lookup nel webhook
    await admin
      .from('pending_checkouts')
      .update({ stripe_session_id: session.id })
      .eq('id', pending.id);

    return NextResponse.json({ id: session.id, url: session.url }, { status: 200 });
  } catch (e) {
    logger.error('[stripe] checkout creation failed', e);
    // Marca il pending come CANCELED così non resta orphan.
    await admin
      .from('pending_checkouts')
      .update({ status: 'CANCELED' })
      .eq('id', pending.id);
    return ApiErrors.internal('Errore nella creazione del pagamento.');
  }
});

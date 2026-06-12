import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase, getServerSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { validateCoupon } from '@/lib/coupons';
import { PICKUP_DISCOUNT_PERCENT } from '@/lib/constants';
import { shippingCentsFor } from '@/lib/shipping';
import { sendEmail } from '@/lib/email/client';
import { orderConfirmedBuyerTemplate, newOrderSellerTemplate } from '@/lib/email/templates';

export const runtime = 'nodejs';

const ItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(99),
  variantId: z.string().uuid().nullable().optional(),
});

const GroupSchema = z.object({
  sellerId: z.string().uuid(),
  items: z.array(ItemSchema).min(1).max(50),
});

const DeliverySchema = z.object({
  fullName: z.string().min(1).max(200),
  address: z.string().min(1).max(300),
  city: z.string().min(1).max(120),
  zip: z.string().min(1).max(20),
  phone: z.string().min(1).max(40),
  notes: z.string().max(500).optional().nullable(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
}).refine((d) => !(d.lat === 0 && d.lng === 0), { message: 'Coordinate di consegna non valide' });

const Body = z.object({
  groups: z.array(GroupSchema).min(1).max(10),
  delivery: DeliverySchema,
  couponCode: z.string().max(40).optional().nullable(),
  pickupInStore: z.boolean().default(false),
  // Opt-in: usa il credito MyCity (gift card / punti convertiti) per scalare il
  // totale. L'importo applicato è deciso SERVER-SIDE (addebito atomico), mai dal client.
  useCredit: z.boolean().default(false),
});

/**
 * Crea ordini COD (pagamento alla consegna) SERVER-SIDE.
 *
 * SICUREZZA (H1 / COD): in passato il client inseriva direttamente gli ordini
 * via `supabase.from('orders').insert(...)` con `total_price`, `discount_amount`
 * e `payment_status` calcolati nel browser e RLS che controllava solo
 * `auth.uid() = user_id`. Un utente poteva quindi creare ordini con prezzi/sconti
 * arbitrari. Qui ricalcoliamo TUTTO dal DB (prezzi prodotto, spedizione, sconto
 * ritiro, coupon) e inseriamo con il client admin. La policy RLS di INSERT su
 * `orders`/`order_items` per il ruolo `authenticated` viene rimossa nella
 * migration di hardening: gli ordini si creano solo via questo endpoint o via
 * webhook Stripe.
 *
 * Rate limit: 30 ordini / 10 min per utente.
 */
export const POST = withAuthRateLimit(
  { name: 'orders-cod', max: 30, windowMs: 10 * 60_000 },
  async ({ user, req }): Promise<NextResponse> => {
    if (!user.email) return ApiErrors.unauthorized();
    if (!user.email_confirmed_at) {
      return ApiErrors.forbidden('Conferma la tua email prima di ordinare.');
    }

    let body: z.infer<typeof Body>;
    try {
      body = Body.parse(await req.json());
    } catch (e) {
      return ApiErrors.invalidRequest('Dati ordine non validi', e instanceof Error ? e.message : undefined);
    }

    const supa = await getServerSupabase();
    const admin = getAdminSupabase();

    // --- 1. Carica i prodotti dal DB (mai trust client su prezzo/seller/stock).
    const allProductIds = body.groups.flatMap((g) => g.items.map((i) => i.productId));
    const { data: products, error: prodErr } = await supa
      .from('products')
      .select('id, name, price, seller_id, stock, status, has_variants')
      .in('id', allProductIds);

    if (prodErr || !products || products.length === 0) {
      return ApiErrors.notFound('Prodotti non trovati.');
    }
    if (products.length !== allProductIds.length) {
      return ApiErrors.invalidRequest('Alcuni prodotti del carrello non sono più disponibili.');
    }

    // --- 1b. Carica le varianti richieste (stock/label/owner) per validarle.
    const allVariantIds = body.groups.flatMap((g) =>
      g.items.map((i) => i.variantId).filter(Boolean) as string[],
    );
    const variantMap = new Map<string, { id: string; product_id: string; label: string; stock: number }>();
    if (allVariantIds.length > 0) {
      const { data: vrows } = await supa
        .from('product_variants')
        .select('id, product_id, label, stock')
        .in('id', allVariantIds);
      for (const v of vrows ?? []) {
        variantMap.set(v.id as string, {
          id: v.id as string,
          product_id: v.product_id as string,
          label: (v.label as string) ?? '',
          stock: (v.stock as number) ?? 0,
        });
      }
    }

    // --- 2. Coordinate negozio (per spedizione distanza-based).
    const sellerIds = Array.from(new Set(body.groups.map((g) => g.sellerId)));
    const { data: sellers } = await supa
      .from('profiles')
      .select('id, store_lat, store_lng')
      .in('id', sellerIds);
    const sellerCoordMap = new Map<string, { lat: number | null; lng: number | null }>();
    for (const s of sellers ?? []) {
      sellerCoordMap.set(s.id, { lat: s.store_lat ?? null, lng: s.store_lng ?? null });
    }

    // --- 3. Valida ogni gruppo + calcola subtotale per gruppo dal DB.
    const subtotalPerGroupCents: number[] = [];
    type CodItem = { productId: string; quantity: number; unitCents: number; variantId: string | null; variantLabel: string | null };
    const itemsPerGroupCents: Array<Array<CodItem>> = [];

    for (const g of body.groups) {
      let groupSubtotalCents = 0;
      const items: Array<CodItem> = [];
      for (const it of g.items) {
        const p = products.find((x) => x.id === it.productId);
        if (!p) return ApiErrors.notFound(`Prodotto ${it.productId} non trovato`);
        if (p.seller_id !== g.sellerId) {
          return ApiErrors.invalidRequest(`Prodotto ${p.name} non appartiene al venditore indicato.`);
        }
        if (p.status !== 'available') {
          return ApiErrors.invalidRequest(`Prodotto ${p.name} non disponibile.`);
        }
        // Varianti: prodotto con varianti richiede una variante valida; lo stock
        // controllato è quello della variante.
        const hasVariants = Boolean((p as { has_variants?: boolean }).has_variants);
        let variantId: string | null = null;
        let variantLabel: string | null = null;
        if (hasVariants) {
          if (!it.variantId) {
            return ApiErrors.invalidRequest(`Scegli un'opzione (es. taglia/colore) per ${p.name}.`);
          }
          const v = variantMap.get(it.variantId);
          if (!v || v.product_id !== p.id) {
            return ApiErrors.invalidRequest(`Variante non valida per ${p.name}.`);
          }
          if (v.stock < it.quantity) {
            return NextResponse.json(
              { error: `Disponibilità insufficiente per ${p.name} (${v.label}): ${v.stock} disponibili.` },
              { status: 409 },
            );
          }
          variantId = v.id;
          variantLabel = v.label;
        } else if (typeof p.stock === 'number' && p.stock < it.quantity) {
          return NextResponse.json(
            { error: `Stock insufficiente per ${p.name} (${p.stock} disponibili).` },
            { status: 409 },
          );
        }
        const unitCents = Math.round(Number(p.price) * 100);
        items.push({ productId: p.id, quantity: it.quantity, unitCents, variantId, variantLabel });
        groupSubtotalCents += unitCents * it.quantity;
      }
      subtotalPerGroupCents.push(groupSubtotalCents);
      itemsPerGroupCents.push(items);
    }

    const grandSubtotalCents = subtotalPerGroupCents.reduce((s, x) => s + x, 0);
    if (grandSubtotalCents <= 0) return ApiErrors.invalidRequest('Importo non valido.');

    // --- 4. Coupon / spedizione / ritiro: ricalcolati server-side.
    let couponDiscountCents = 0;
    let couponFreeShipping = false;
    let validatedCouponCode: string | null = null;
    if (body.couponCode && body.couponCode.trim()) {
      const couponRes = await validateCoupon(body.couponCode, grandSubtotalCents / 100, user.id, supa);
      if (!couponRes.ok) return ApiErrors.invalidRequest(`Coupon non valido: ${couponRes.reason}`);
      couponDiscountCents = Math.max(0, Math.round(couponRes.discount * 100));
      couponFreeShipping = couponRes.freeShipping;
      validatedCouponCode = couponRes.coupon.code;
    }

    const shippingPerGroupCents = body.groups.map((g, i) => {
      const coord = sellerCoordMap.get(g.sellerId) ?? { lat: null, lng: null };
      return shippingCentsFor({
        subtotal: subtotalPerGroupCents[i] / 100,
        storeLat: coord.lat,
        storeLng: coord.lng,
        deliveryLat: body.delivery.lat ?? null,
        deliveryLng: body.delivery.lng ?? null,
        pickupInStore: body.pickupInStore,
        freeShipping: couponFreeShipping,
      });
    });
    const pickupDiscountCents = body.pickupInStore
      ? Math.round(grandSubtotalCents * (PICKUP_DISCOUNT_PERCENT / 100))
      : 0;

    // --- 5. Inserisci N ordini (uno per gruppo) con il client admin.
    const createdOrderIds: string[] = [];
    for (let i = 0; i < body.groups.length; i++) {
      const g = body.groups[i];
      const subtotal = subtotalPerGroupCents[i];
      const shipping = shippingPerGroupCents[i];
      const portion = grandSubtotalCents > 0 ? subtotal / grandSubtotalCents : 0;
      const couponPortionCents = Math.round(couponDiscountCents * portion);
      const pickupPortionCents = Math.round(pickupDiscountCents * portion);
      const discountCents = couponPortionCents + pickupPortionCents;
      const grossTotalCents = Math.max(0, subtotal + shipping - discountCents);

      // RISERVA ATOMICA DELLO STOCK del gruppo PRIMA di creare l'ordine (P0-4).
      // Con variante, la riserva scala lo stock della variante.
      const groupStockItems = itemsPerGroupCents[i].map((it) => ({
        product_id: it.productId,
        variant_id: it.variantId,
        qty: it.quantity,
      }));
      const { error: resErr } = await admin.rpc('reserve_stock', { p_items: groupStockItems });
      if (resErr) {
        logger.warn('[cod] reserve_stock fallita', { sellerId: g.sellerId, message: resErr.message });
        return NextResponse.json(
          { error: 'Alcuni articoli non sono più disponibili nelle quantità richieste.' },
          { status: 409 },
        );
      }

      // Credito MyCity (opt-in): addebito atomico fino a coprire il totale del
      // gruppo. Speso greedy gruppo-per-gruppo; se l'ordine fallisce, si storna.
      let walletAppliedCents = 0;
      if (body.useCredit && grossTotalCents > 0) {
        const { data: applied, error: wErr } = await admin.rpc('wallet_debit', {
          p_user: user.id,
          p_max_cents: grossTotalCents,
          p_reason: 'order_cod',
          p_ref: null,
        });
        if (wErr) {
          logger.warn('[cod] wallet_debit fallita', { sellerId: g.sellerId, message: wErr.message });
        } else {
          walletAppliedCents = typeof applied === 'number' ? applied : 0;
        }
      }
      const totalCents = Math.max(0, grossTotalCents - walletAppliedCents);

      const { data: order, error: orderErr } = await admin
        .from('orders')
        .insert({
          user_id: user.id,
          seller_id: g.sellerId,
          total_price: totalCents / 100,
          shipping_cost: shipping / 100,
          discount_amount: discountCents / 100,
          wallet_applied_cents: walletAppliedCents,
          coupon_code: validatedCouponCode,
          pickup_in_store: body.pickupInStore,
          payment_method: 'cod',
          payment_status: 'PENDING',
          delivery_status: 'NEW',
          delivery_full_name: body.delivery.fullName,
          delivery_phone: body.delivery.phone,
          delivery_address: body.delivery.address,
          delivery_city: body.delivery.city,
          delivery_zip: body.delivery.zip,
          delivery_notes: body.delivery.notes ?? null,
          delivery_lat: body.delivery.lat ?? null,
          delivery_lng: body.delivery.lng ?? null,
        })
        .select('id')
        .single();

      if (orderErr || !order) {
        await admin.rpc('restore_stock', { p_items: groupStockItems }); // rilascia la riserva del gruppo fallito
        if (walletAppliedCents > 0) {
          // Storna il credito addebitato per un ordine che non è stato creato.
          await admin.rpc('wallet_credit', {
            p_user: user.id,
            p_cents: walletAppliedCents,
            p_reason: 'order_cod_refund',
            p_ref: null,
          });
        }
        logger.error(orderErr ?? new Error('cod-order-insert-null'), { context: 'cod-order-insert', sellerId: g.sellerId });
        return ApiErrors.internal('Errore nella creazione ordine.');
      }

      const itemsRows = itemsPerGroupCents[i].map((it) => ({
        order_id: order.id,
        product_id: it.productId,
        quantity: it.quantity,
        unit_price: it.unitCents / 100,
        variant_id: it.variantId,
        variant_label: it.variantLabel,
      }));
      const { error: itemsErr } = await admin.from('order_items').insert(itemsRows);
      if (itemsErr) {
        logger.error(itemsErr, { context: 'cod-order-items-insert', orderId: order.id });
      }

      // Notifica in-app al venditore — nuovo ordine COD ricevuto
      await admin.from('notifications').insert({
        user_id: g.sellerId,
        title: '🎉 Nuovo ordine!',
        body: `Ordine #${order.id.slice(0, 6).toUpperCase()} · €${(totalCents / 100).toFixed(2)} · pagamento alla consegna`,
        link: `/seller/orders/${order.id}`,
      });

      // Email al venditore (oltre alla notifica) — per la carta parte dal webhook,
      // per il COD va inviata qui. Best-effort.
      try {
        const { data: sellerAuth } = await admin.auth.admin.getUserById(g.sellerId);
        const sellerEmail = sellerAuth?.user?.email;
        if (sellerEmail) {
          const itemsCount = g.items.reduce((s, it) => s + it.quantity, 0);
          const t = newOrderSellerTemplate({
            sellerName: null,
            orderId: order.id,
            total: totalCents / 100,
            itemsCount,
          });
          await sendEmail({ to: sellerEmail, subject: t.subject, html: t.html, text: t.text });
        }
      } catch (e) {
        logger.warn('[cod] email nuovo ordine al venditore fallita', { orderId: order.id, e });
      }

      // Conferma al BUYER — notifica in-app + email (best-effort: un errore qui
      // non deve far fallire la creazione dell'ordine). Per gli ordini con carta
      // la conferma parte dal webhook Stripe; per il COD va inviata qui.
      await admin.from('notifications').insert({
        user_id: user.id,
        title: '✅ Ordine ricevuto',
        body: `Il tuo ordine #${order.id.slice(0, 6).toUpperCase()} è stato inviato al negozio. Ti avviseremo quando viene accettato.`,
        link: `/orders/${order.id}`,
      });
      try {
        const { data: sellerProfile } = await admin
          .from('profiles')
          .select('store_name')
          .eq('id', g.sellerId)
          .single();
        const t = orderConfirmedBuyerTemplate({
          name: body.delivery.fullName,
          orderId: order.id,
          total: totalCents / 100,
          storeName: sellerProfile?.store_name ?? 'il negozio',
        });
        await sendEmail({ to: user.email, subject: t.subject, html: t.html, text: t.text });
      } catch (e) {
        logger.warn('[cod] email conferma ordine al buyer fallita', { orderId: order.id, e });
      }

      createdOrderIds.push(order.id);
    }

    // Traccia uso coupon (server-side authoritative).
    if (validatedCouponCode && createdOrderIds.length > 0) {
      const { error: cErr } = await admin.rpc('increment_coupon_usage', { p_code: validatedCouponCode });
      if (cErr) logger.warn('[cod] increment_coupon_usage fallito', { code: validatedCouponCode, message: cErr.message });
    }

    return NextResponse.json({ orderIds: createdOrderIds }, { status: 200 });
  },
);

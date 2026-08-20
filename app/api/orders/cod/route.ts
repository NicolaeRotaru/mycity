import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase, getServerSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { withAuthRateLimit, assertCanPurchase } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { validateCoupon } from '@/lib/coupons';
import { PICKUP_DISCOUNT_PERCENT, PLATFORM_DELIVERY_FEE_CENTS } from '@/lib/constants';
import { shippingCentsFor, compensoRiderCents } from '@/lib/shipping';
import { coordinateDaIndirizziSalvati } from '@/lib/shipping-coordinate';
import { isStoreClosedForOrder } from '@/lib/store-hours';
import { computeOrderSplit } from '@/lib/stripe/client';
import { fetchActiveDiscounts, discountedUnitCents } from '@/lib/promotions';
import { sendEmail } from '@/lib/email/client';
import { orderConfirmedBuyerTemplate, newOrderSellerTemplate } from '@/lib/email/templates';
import { ripartisciCentesimi, riduciAlTetto } from '@/lib/stripe/ripartizione';

// 009 / 190 — Queste risposte uscivano come `{ error: '…' }` grezzo, mentre
// tutto il resto del progetto risponde `{ ok:false, error:{ code, message } }`
// — la forma che il codice del browser si aspetta e che il file delle
// risposte dichiara «mai inconsistente». Sulle due rotte dei soldi il
// cliente vedeva «Qualcosa non ha funzionato» al posto di «il negozio e'
// chiuso»: il messaggio giusto c'era, e si perdeva nella forma sbagliata.

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
  // Fascia di consegna scelta (es. "Oggi · 18:00–20:00"). Etichetta informativa
  // persistita su orders.delivery_slot; null per ritiro o se non scelta. Non
  // influisce su prezzi/spedizione.
  deliverySlot: z.string().max(120).optional().nullable(),
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
  async ({ user, profile, req }): Promise<NextResponse> => {
    const purchaseBlock = assertCanPurchase(profile);
    if (purchaseBlock) return purchaseBlock;
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
    const uniqueProductIds = [...new Set(allProductIds)];
    const { data: products, error: prodErr } = await supa
      .from('products')
      .select('id, name, price, seller_id, stock, status, has_variants')
      .in('id', uniqueProductIds);

    if (prodErr || !products || products.length === 0) {
      return ApiErrors.notFound('Prodotti non trovati.');
    }
    if (products.length !== uniqueProductIds.length) {
      return ApiErrors.invalidRequest('Alcuni prodotti del carrello non sono più disponibili.');
    }

    // Sconti promo attivi (per prodotto): il cliente paga il prezzo scontato che
    // vede, non il prezzo pieno. Stessa fonte del badge "In promo -X%".
    const discountMap = await fetchActiveDiscounts(supa, allProductIds);

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
      .select('id, store_name, store_lat, store_lng, store_hours')
      .in('id', sellerIds);
    const sellerCoordMap = new Map<string, { lat: number | null; lng: number | null }>();
    for (const s of sellers ?? []) {
      sellerCoordMap.set(s.id, { lat: s.store_lat ?? null, lng: s.store_lng ?? null });
    }

    // --- 2b. Orari negozio: niente consegna a domicilio verso un negozio CHIUSO
    // adesso (il rider andrebbe a vuoto — lo scenario "ordine alle 3 di notte").
    // Solo se il venditore ha orari configurati (NULL-safe). Il ritiro in negozio
    // è esente: il cliente passa durante gli orari di apertura.
    if (!body.pickupInStore) {
      for (const s of sellers ?? []) {
        if (isStoreClosedForOrder(s.store_hours)) {
          return ApiErrors.conflict(`${s.store_name ?? 'Il negozio'} è chiuso in questo momento. Riprova durante gli orari di apertura indicati sulla pagina del negozio.`);
        }
      }
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
            return ApiErrors.conflict(`Disponibilità insufficiente per ${p.name} (${v.label}): ${v.stock} disponibili.`);
          }
          variantId = v.id;
          variantLabel = v.label;
        } else if (typeof p.stock === 'number' && p.stock < it.quantity) {
          return ApiErrors.conflict(`Stock insufficiente per ${p.name} (${p.stock} disponibili).`);
        }
        const unitCents = discountedUnitCents(p.price, discountMap.get(p.id) ?? 0);
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
      // Claim atomico: check + increment in un'unica operazione — previene la race condition (fix #36).
      // Se due richieste parallele arrivano con lo stesso coupon, solo una ottiene il claim.
      const { data: claimed, error: claimErr } = await admin.rpc('claim_coupon', { p_code: validatedCouponCode });
      if (claimErr || !claimed) {
        return ApiErrors.invalidRequest('Coupon non disponibile: potrebbe essere esaurito nel frattempo.');
      }
    }

    // Coordinate della consegna prese dal database, non dal browser: il prezzo
    // della consegna dipende dalla distanza, e finora quel numero lo scriveva il
    // client. Se l'indirizzo non è fra quelli salvati dalla persona, si resta
    // senza coordinate e vale la tariffa fissa.
    const coordConsegna = await coordinateDaIndirizziSalvati(admin, user.id, {
      address: body.delivery.address,
      city: body.delivery.city,
      zip: body.delivery.zip,
    });

    const shippingPerGroupCents = body.groups.map((g, i) => {
      const coord = sellerCoordMap.get(g.sellerId) ?? { lat: null, lng: null };
      return shippingCentsFor({
        subtotal: subtotalPerGroupCents[i] / 100,
        storeLat: coord.lat,
        storeLng: coord.lng,
        deliveryLat: coordConsegna?.lat ?? null,
        deliveryLng: coordConsegna?.lng ?? null,
        pickupInStore: body.pickupInStore,
        freeShipping: couponFreeShipping,
      });
    });
    const pickupDiscountCents = body.pickupInStore
      ? Math.round(grandSubtotalCents * (PICKUP_DISCOUNT_PERCENT / 100))
      : 0;

    // 058 / 165 — LA STESSA MATEMATICA DELLA CARTA, NON UNA SUA IMITAZIONE.
    //
    // Qui lo sconto veniva spalmato sui negozi con `Math.round(sconto * quota)`
    // fatto una volta per gruppo, e senza nessun tetto complessivo. Due guai:
    //  · gli arrotondamenti indipendenti non tornano — un buono da 10,01 € su
    //    tre negozi diventava 10,00 o 10,02, e i totali per negozio non
    //    quadravano con quello che il cliente paga in contanti al fattorino;
    //  · senza tetto, uno sconto piu' grande del carrello produceva un ordine
    //    con totale negativo, cioe' un negozio che paga il cliente.
    // La rotta della carta ha gia' risolto tutte e due le cose con due funzioni
    // scritte e provate. Non serviva una seconda versione: serviva usarle.
    const grandShippingCents = shippingPerGroupCents.reduce((s, x) => s + x, 0);
    const tettoScontoCents = Math.max(0, grandSubtotalCents + grandShippingCents - 1);
    const scontiLimitati = riduciAlTetto(couponDiscountCents, pickupDiscountCents, tettoScontoCents);
    const quoteCoupon = ripartisciCentesimi(scontiLimitati.codice, subtotalPerGroupCents);
    const quoteRitiro = ripartisciCentesimi(scontiLimitati.ritiro, subtotalPerGroupCents);

    // --- 5. Inserisci N ordini (uno per gruppo) con il client admin.
    const createdOrderIds: string[] = [];
    // #210 e #213 — Il browser non deve piu' indovinare quanto e' stato
    // ordinato. Qui c'e' l'importo che il cliente pagherà davvero, per ogni
    // ordine, col negozio vero: sono i numeri che tornano indietro e finiscono
    // nella misura. Prima ne partiva uno solo, con la stima del browser e la
    // parola «multi» al posto del negozio.
    const ordiniCreati: Array<{ id: string; sellerId: string; totalCents: number }> = [];
    const reservedStockPerGroup: Array<Array<{ product_id: string; variant_id: string | null; qty: number }>> = [];
    const walletAppliedPerGroup: number[] = [];

    const rollbackCreatedCodOrders = async () => {
      for (let j = createdOrderIds.length - 1; j >= 0; j--) {
        const oid = createdOrderIds[j];
        await admin.from('order_items').delete().eq('order_id', oid);
        await admin.from('orders').delete().eq('id', oid);
        await admin.rpc('restore_stock', { p_items: reservedStockPerGroup[j] });
        if (walletAppliedPerGroup[j] > 0) {
          await admin.rpc('wallet_credit', {
            p_user: user.id,
            p_cents: walletAppliedPerGroup[j],
            p_reason: 'order_cod_refund',
            p_ref: oid,
          });
        }
      }
      createdOrderIds.length = 0;
      ordiniCreati.length = 0;
      reservedStockPerGroup.length = 0;
      walletAppliedPerGroup.length = 0;
    };

    for (let i = 0; i < body.groups.length; i++) {
      const g = body.groups[i];
      const subtotal = subtotalPerGroupCents[i];
      const shipping = shippingPerGroupCents[i];
      const couponPortionCents = quoteCoupon[i];
      const pickupPortionCents = quoteRitiro[i];
      const discountCents = couponPortionCents + pickupPortionCents;
      // Fee di consegna piattaforma (€3): solo per consegna a domicilio, mai per
      // ritiro in negozio. Il cliente la paga in contanti insieme all'ordine.
      const deliveryFeeCents = body.pickupInStore ? 0 : PLATFORM_DELIVERY_FEE_CENTS;
      const grossTotalCents = Math.max(0, subtotal + shipping + deliveryFeeCents - discountCents);

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
        // Annulla anche gli ordini dei negozi PRECEDENTI di questo carrello.
        //
        // Il difetto: qui si usciva con un 409 senza toccarli. Con la spesa da
        // due negozi e l'ultimo articolo finito nel secondo, il cliente vedeva
        // «non piu' disponibile» e credeva di non aver ordinato niente — mentre
        // al primo negozio l'ordine era stato creato davvero, con la merce
        // scalata. Le altre due uscite di errore, poche righe sotto, lo
        // facevano: mancava solo questa.
        await rollbackCreatedCodOrders();
        return ApiErrors.conflict('Alcuni articoli non sono più disponibili nelle quantità richieste.');
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

      // 🔴-1 settlement COD: registra commissione (10% del SUBTOTALE prodotti del
      // valore di vendita lordo, prima del wallet) e netto venditore (90% del
      // subtotale), come per gli ordini carta. La commissione NON grava su fee di
      // consegna né spedizione. Il pagamento al venditore — gated sulla rimessa
      // contanti del rider — avverrà a parte: qui si registrano solo gli importi.
      const { applicationFeeCents: codFeeCents, sellerPayoutCents: codSellerPayoutCents } = computeOrderSplit({
        totalCents: grossTotalCents,
        deliveryFeeCents,
        shippingCents: shipping,
      });

      const { data: order, error: orderErr } = await admin
        .from('orders')
        .insert({
          user_id: user.id,
          seller_id: g.sellerId,
          total_price: totalCents / 100,
          shipping_cost: shipping / 100,
          delivery_fee_cents: deliveryFeeCents,
          // Il compenso del fattorino, scritto alla creazione dell'ordine e
          // scollegato da quanto ha pagato il cliente. Prima questa colonna non
          // veniva popolata da nessuna parte, quindi al momento del pagamento si
          // ricadeva sul prezzo di spedizione — che sopra i 30 euro e' zero:
          // il fattorino consegnava gratis.
          rider_fee_cents: compensoRiderCents({
            storeLat: (sellerCoordMap.get(g.sellerId) ?? { lat: null }).lat ?? null,
            storeLng: (sellerCoordMap.get(g.sellerId) ?? { lng: null }).lng ?? null,
            deliveryLat: coordConsegna?.lat ?? null,
            deliveryLng: coordConsegna?.lng ?? null,
            pickupInStore: body.pickupInStore,
          }),
          application_fee_cents: codFeeCents,
          seller_payout_cents: codSellerPayoutCents,
          // In attesa della rimessa contanti del rider (un admin la conferma →
          // confirm_cod_remittance → 'HELD' → payout venditore in slice 3).
          payout_status: 'AWAITING_REMITTANCE',
          discount_amount: discountCents / 100,
          wallet_applied_cents: walletAppliedCents,
          coupon_code: validatedCouponCode,
          pickup_in_store: body.pickupInStore,
          // Fascia di consegna scelta dal buyer (null per ritiro / non scelta).
          delivery_slot: body.pickupInStore ? null : (body.deliverySlot ?? null),
          payment_method: 'cod',
          payment_status: 'PENDING',
          delivery_status: 'NEW',
          delivery_full_name: body.delivery.fullName,
          delivery_phone: body.delivery.phone,
          delivery_address: body.delivery.address,
          delivery_city: body.delivery.city,
          delivery_zip: body.delivery.zip,
          delivery_notes: body.delivery.notes ?? null,
          delivery_lat: coordConsegna?.lat ?? body.delivery.lat ?? null,
          delivery_lng: coordConsegna?.lng ?? body.delivery.lng ?? null,
        })
        .select('id')
        .single();

      if (orderErr || !order) {
        await rollbackCreatedCodOrders();
        await admin.rpc('restore_stock', { p_items: groupStockItems });
        if (walletAppliedCents > 0) {
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

      reservedStockPerGroup.push(groupStockItems);
      walletAppliedPerGroup.push(walletAppliedCents);

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
        await admin.from('orders').delete().eq('id', order.id);
        await admin.rpc('restore_stock', { p_items: groupStockItems });
        if (walletAppliedCents > 0) {
          await admin.rpc('wallet_credit', {
            p_user: user.id,
            p_cents: walletAppliedCents,
            p_reason: 'order_cod_refund',
            p_ref: order.id,
          });
        }
        reservedStockPerGroup.pop();
        walletAppliedPerGroup.pop();
        await rollbackCreatedCodOrders();
        return ApiErrors.internal('Errore nella creazione ordine.');
      }

      // Notifica in-app al venditore — nuovo ordine COD ricevuto
      await admin.from('notifications').insert({
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
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
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
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
      ordiniCreati.push({ id: order.id, sellerId: g.sellerId, totalCents });
    }

    // NB: il coupon è già stato claimato atomicamente sopra (claim_coupon, fix #36).
    // Non chiamiamo più increment_coupon_usage qui.

    return NextResponse.json({ orderIds: createdOrderIds, ordini: ordiniCreati }, { status: 200 });
  },
);

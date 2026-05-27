import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { createCheckoutSession, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

const Body = z.object({
  sellerId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive().max(99),
  })).min(1).max(50),
  shippingCents: z.number().int().nonnegative().default(0),
  metadata: z.record(z.string()).optional(),
});

export const POST = withAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!isStripeConfigured()) {
    return ApiErrors.unavailable('Pagamenti elettronici non disponibili. Usa pagamento alla consegna.');
  }
  if (!user.email) return ApiErrors.unauthorized();
  if (!user.email_confirmed_at) {
    return ApiErrors.forbidden('Conferma la tua email prima di pagare.');
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e: any) {
    return ApiErrors.invalidRequest('Dati ordine non validi', e?.message);
  }

  const supa = getServerSupabase();

  // Carica prodotti reali dal DB (mai fidarsi del prezzo client-side)
  const productIds = body.items.map((i) => i.productId);
  const { data: products, error: prodErr } = await supa
    .from('products')
    .select('id, name, price, images, seller_id, stock, status, is_approved')
    .in('id', productIds);

  if (prodErr || !products || products.length === 0) {
    return ApiErrors.notFound('Prodotti non trovati.');
  }

  // Validazioni
  for (const p of products) {
    if (p.seller_id !== body.sellerId) {
      return ApiErrors.invalidRequest(`Prodotto ${p.id} non appartiene al venditore indicato.`);
    }
    if (!p.is_approved || p.status !== 'available') {
      return ApiErrors.invalidRequest(`Prodotto ${p.name} non disponibile.`);
    }
    const requested = body.items.find((i) => i.productId === p.id)?.quantity ?? 0;
    if (typeof p.stock === 'number' && p.stock < requested) {
      return NextResponse.json({ error: `Stock insufficiente per ${p.name} (${p.stock} disponibili).` }, { status: 409 });
    }
  }

  // Costruisci line items per Stripe
  const checkoutItems = body.items.map((it) => {
    const prod = products.find((p) => p.id === it.productId)!;
    const cover = Array.isArray(prod.images) ? prod.images[0] : null;
    return {
      name: prod.name,
      quantity: it.quantity,
      unitAmountCents: Math.round(Number(prod.price) * 100),
      imageUrl: typeof cover === 'string' ? cover : undefined,
    };
  });

  const subtotalCents = checkoutItems.reduce((s, i) => s + i.unitAmountCents * i.quantity, 0);
  const totalCents = subtotalCents + body.shippingCents;

  if (totalCents <= 0) {
    return ApiErrors.invalidRequest('Importo non valido.');
  }

  const successUrl = `${env.appUrl()}/orders?stripe=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${env.appUrl()}/cart?stripe=canceled`;

  try {
    const session = await createCheckoutSession({
      items: checkoutItems,
      shippingCents: body.shippingCents,
      buyerEmail: user.email,
      buyerUserId: user.id,
      sellerId: body.sellerId,
      successUrl,
      cancelUrl,
      metadata: {
        ...(body.metadata ?? {}),
        // Salva snapshot items in metadata (max 500 char per key/value)
        items: JSON.stringify(body.items).slice(0, 450),
      },
    });
    return NextResponse.json({ id: session.id, url: session.url }, { status: 200 });
  } catch (e) {
    logger.error('[stripe] checkout creation failed', e);
    return ApiErrors.internal('Errore nella creazione del pagamento.');
  }
});

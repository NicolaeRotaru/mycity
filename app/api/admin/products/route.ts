import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';
import { saveProductVariantsServer } from '@/lib/products/persistVariantsServer';
import { MYCITY_SELLER_ID } from '@/lib/products/mycitySeller';
import { type ProductVariant } from '@/lib/products/variants';

export const runtime = 'nodejs';

/**
 * POST/PATCH /api/admin/products
 * Crea/aggiorna un prodotto per QUALSIASI negozio (seller_id scelto dall'admin,
 * incluso il negozio di sistema "MyCity"). Passa da qui col client service-role
 * perché la RLS di products consente la scrittura solo al seller proprietario.
 */

const variantSchema = z.object({
  id: z.string().uuid().optional(),
  options: z.record(z.string()),
  label: z.string(),
  stock: z.number().int().min(0),
  position: z.number().int().min(0).optional(),
});

const externalDataSchema = z
  .object({
    price: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    delivery_min_days: z.number().nullable().optional(),
    delivery_max_days: z.number().nullable().optional(),
    delivery_label: z.string().nullable().optional(),
    availability: z.string().nullable().optional(),
    source_title: z.string().nullable().optional(),
    fetched_at: z.string().optional(),
  })
  .passthrough();

const productFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(8000).optional(),
  price: z.number().nonnegative(),
  compare_at_price: z.number().nonnegative().nullable().optional(),
  unit: z.string().nullable().optional(),
  condition: z.string().nullable().optional(),
  stock: z.number().int().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  images: z.array(z.string()).optional(),
  attributes: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  express_enabled: z.boolean().nullable().optional(),
  status: z.string().optional(),
};

const externalFields = {
  external_source_url: z.string().url().max(2000).nullable().optional(),
  external_marketplace: z.enum(['ebay', 'amazon', 'aliexpress', 'other']).nullable().optional(),
  external_data: externalDataSchema.nullable().optional(),
};

const createSchema = z.object({
  seller_id: z.string().uuid(),
  variants: z.array(variantSchema).optional(),
  ...productFields,
  ...externalFields,
});

const updateSchema = z.object({
  id: z.string().uuid(),
  seller_id: z.string().uuid().optional(),
  variants: z.array(variantSchema).optional(),
  ...productFields,
  ...externalFields,
}).partial({ name: true, price: true });

/** Verifica che il seller esista e sia un venditore (o il negozio MyCity). */
async function assertSeller(admin: ReturnType<typeof getAdminSupabase>, sellerId: string): Promise<boolean> {
  if (sellerId === MYCITY_SELLER_ID) return true;
  const { data } = await admin.from('profiles').select('role').eq('id', sellerId).single();
  return (data as { role?: string } | null)?.role === 'seller';
}

function externalPatch(d: { external_source_url?: string | null; external_marketplace?: string | null; external_data?: unknown }) {
  const patch: Record<string, unknown> = {};
  if (d.external_source_url !== undefined) patch.external_source_url = d.external_source_url;
  if (d.external_marketplace !== undefined) patch.external_marketplace = d.external_marketplace;
  if (d.external_data !== undefined) {
    patch.external_data = d.external_data;
    patch.external_synced_at = d.external_data ? new Date().toISOString() : null;
    patch.external_sync_status = 'idle';
  }
  return patch;
}

export const POST = withAdminAuth(async ({ user, req }) => {
  let body: unknown;
  try { body = await req.json(); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.issues[0]?.message ?? 'Dati non validi');
  const d = parsed.data;

  const admin = getAdminSupabase();
  if (!(await assertSeller(admin, d.seller_id))) return ApiErrors.invalidRequest('Negozio di destinazione non valido');

  const { data, error } = await admin
    .from('products')
    .insert({
      seller_id: d.seller_id,
      name: d.name,
      description: d.description ?? '',
      price: d.price,
      compare_at_price: d.compare_at_price ?? null,
      unit: d.unit ?? null,
      condition: d.condition ?? null,
      stock: d.stock ?? 0,
      category_id: d.category_id ?? null,
      images: d.images ?? [],
      attributes: d.attributes ?? {},
      tags: d.tags ?? [],
      express_enabled: d.express_enabled ?? null,
      status: d.status ?? 'available',
      ...externalPatch(d),
    })
    .select('id')
    .single();
  if (error) return ApiErrors.internal('Impossibile creare il prodotto');

  const id = data.id as string;
  if (d.variants && d.variants.length > 0) {
    try {
      await saveProductVariantsServer(admin, id, d.variants as ProductVariant[]);
    } catch {
      return ApiErrors.internal('Prodotto creato ma errore nel salvataggio delle varianti');
    }
  }

  await writeAudit({
    actorId: user.id,
    action: 'product.create',
    targetTable: 'products',
    targetId: id,
    metadata: { seller_id: d.seller_id, external_marketplace: d.external_marketplace ?? null },
  });

  return apiSuccess({ id });
});

export const PATCH = withAdminAuth(async ({ user, req }) => {
  let body: unknown;
  try { body = await req.json(); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.issues[0]?.message ?? 'Dati non validi');
  const { id, variants, ...rest } = parsed.data;

  const admin = getAdminSupabase();
  if (rest.seller_id && !(await assertSeller(admin, rest.seller_id))) {
    return ApiErrors.invalidRequest('Negozio di destinazione non valido');
  }

  const patch: Record<string, unknown> = {};
  if (rest.seller_id !== undefined) patch.seller_id = rest.seller_id;
  if (rest.name !== undefined) patch.name = rest.name;
  if (rest.description !== undefined) patch.description = rest.description;
  if (rest.price !== undefined) patch.price = rest.price;
  if (rest.compare_at_price !== undefined) patch.compare_at_price = rest.compare_at_price;
  if (rest.unit !== undefined) patch.unit = rest.unit;
  if (rest.condition !== undefined) patch.condition = rest.condition;
  if (rest.stock !== undefined) patch.stock = rest.stock;
  if (rest.category_id !== undefined) patch.category_id = rest.category_id;
  if (rest.images !== undefined) patch.images = rest.images;
  if (rest.attributes !== undefined) patch.attributes = rest.attributes;
  if (rest.tags !== undefined) patch.tags = rest.tags;
  if (rest.express_enabled !== undefined) patch.express_enabled = rest.express_enabled;
  if (rest.status !== undefined) patch.status = rest.status;
  Object.assign(patch, externalPatch(rest));

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from('products').update(patch).eq('id', id);
    if (error) return ApiErrors.internal('Impossibile aggiornare il prodotto');
  }

  if (variants) {
    try {
      await saveProductVariantsServer(admin, id, variants as ProductVariant[]);
    } catch {
      return ApiErrors.internal('Errore nel salvataggio delle varianti');
    }
  }

  await writeAudit({
    actorId: user.id,
    action: 'product.update',
    targetTable: 'products',
    targetId: id,
    metadata: { fields: Object.keys(patch) },
  });

  return apiSuccess({ ok: true });
});

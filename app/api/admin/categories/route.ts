import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * POST/PATCH/DELETE /api/admin/categories
 * CRUD delle categorie del marketplace. SELECT pubblica (policy esistente); la
 * scrittura non ha policy → passa da qui (withAdminAuth + service-role).
 */

const slugSchema = z.string().trim().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug: solo minuscole, numeri e trattini');
const baseFields = {
  name: z.string().trim().min(1).max(60),
  slug: slugSchema,
  icon: z.string().trim().max(8).optional().or(z.literal('')),
  parent_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
  featured: z.boolean().optional(),
};

const createSchema = z.object(baseFields);
const updateSchema = z.object({ id: z.string().uuid(), ...baseFields }).partial({ name: true, slug: true });

export const POST = withAdminAuth(async ({ req }) => {
  let body: unknown;
  try { body = await req.json(); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.issues[0]?.message ?? 'Dati non validi');
  const d = parsed.data;

  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from('categories')
    .insert({
      name: d.name, slug: d.slug, icon: d.icon?.trim() || null,
      parent_id: d.parent_id ?? null, sort_order: d.sort_order ?? 0, featured: d.featured ?? false,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return ApiErrors.invalidRequest('Slug già esistente');
    return ApiErrors.internal('Impossibile creare la categoria');
  }
  return apiSuccess({ id: data.id });
});

export const PATCH = withAdminAuth(async ({ req }) => {
  let body: unknown;
  try { body = await req.json(); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.issues[0]?.message ?? 'Dati non validi');
  const { id, ...rest } = parsed.data;

  const patch: Record<string, unknown> = {};
  if (rest.name !== undefined) patch.name = rest.name;
  if (rest.slug !== undefined) patch.slug = rest.slug;
  if (rest.icon !== undefined) patch.icon = rest.icon.trim() || null;
  if (rest.parent_id !== undefined) patch.parent_id = rest.parent_id;
  if (rest.sort_order !== undefined) patch.sort_order = rest.sort_order;
  if (rest.featured !== undefined) patch.featured = rest.featured;
  if (Object.keys(patch).length === 0) return ApiErrors.invalidRequest('Nessun campo da aggiornare');

  const admin = getAdminSupabase();
  const { error } = await admin.from('categories').update(patch).eq('id', id);
  if (error) {
    if (error.code === '23505') return ApiErrors.invalidRequest('Slug già esistente');
    return ApiErrors.internal('Impossibile aggiornare la categoria');
  }
  return apiSuccess({ ok: true });
});

export const DELETE = withAdminAuth(async ({ req }) => {
  let body: unknown;
  try { body = await req.json(); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }
  const id = (body as { id?: string })?.id;
  if (!id || !z.string().uuid().safeParse(id).success) return ApiErrors.invalidRequest('ID non valido');

  const admin = getAdminSupabase();
  const { error } = await admin.from('categories').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') return ApiErrors.invalidRequest('Categoria usata da prodotti o sottocategorie: non eliminabile');
    return ApiErrors.internal('Impossibile eliminare la categoria');
  }
  return apiSuccess({ ok: true });
});

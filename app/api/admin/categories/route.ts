import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { writeAudit } from '@/lib/audit';

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

type ClientAdmin = ReturnType<typeof getAdminSupabase>;

/**
 * Le categorie hanno DUE livelli: principali e sottocategorie. Il pannello ne
 * disegna solo due, e il modulo prodotto risale i genitori senza tetto.
 * Quindi un genitore deve essere una principale, diversa dalla categoria
 * stessa, e una categoria che ha già figli non può diventare figlia.
 * Così non nascono né nipoti invisibili né cerchi A→B→A.
 * Torna il messaggio d'errore, o null se va bene.
 */
async function genitoreNonAmmesso(admin: ClientAdmin, id: string | null, parentId: string): Promise<string | null> {
  if (id && parentId === id) return 'Una categoria non può essere genitore di se stessa';
  const { data: genitore, error } = await admin.from('categories').select('id, parent_id').eq('id', parentId).maybeSingle();
  if (error) return 'Non riesco a controllare la categoria genitore: riprova';
  if (!genitore) return 'La categoria genitore non esiste';
  if ((genitore as { parent_id: string | null }).parent_id) return 'Il genitore deve essere una categoria principale';
  if (id) {
    const { count, error: e2 } = await admin.from('categories').select('id', { count: 'exact', head: true }).eq('parent_id', id);
    if (e2) return 'Non riesco a controllare le sottocategorie: riprova';
    if ((count ?? 0) > 0) return 'Questa categoria ha sottocategorie: non può diventare a sua volta una sottocategoria';
  }
  return null;
}
const updateSchema = z.object({ id: z.string().uuid(), ...baseFields }).partial({ name: true, slug: true });

export const POST = withAdminAuth(async ({ req, user }) => {
  let body: unknown;
  try { body = await jsonRichiesta(req, TETTO_JSON); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.issues[0]?.message ?? 'Dati non validi');
  const d = parsed.data;

  const admin = getAdminSupabase();
  if (d.parent_id) {
    const no = await genitoreNonAmmesso(admin, null, d.parent_id);
    if (no) return ApiErrors.invalidRequest(no);
  }
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
  await writeAudit({ actorId: user.id, action: 'category.create', targetTable: 'categories', targetId: data.id, metadata: { name: d.name, slug: d.slug } });
  return apiSuccess({ id: data.id });
});

export const PATCH = withAdminAuth(async ({ req, user }) => {
  let body: unknown;
  try { body = await jsonRichiesta(req, TETTO_JSON); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }
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
  if (typeof rest.parent_id === 'string') {
    const no = await genitoreNonAmmesso(admin, id, rest.parent_id);
    if (no) return ApiErrors.invalidRequest(no);
  }
  const { error } = await admin.from('categories').update(patch).eq('id', id);
  if (error) {
    if (error.code === '23505') return ApiErrors.invalidRequest('Slug già esistente');
    return ApiErrors.internal('Impossibile aggiornare la categoria');
  }
  await writeAudit({ actorId: user.id, action: 'category.update', targetTable: 'categories', targetId: id, metadata: { campi: Object.keys(patch) } });
  return apiSuccess({ ok: true });
});

export const DELETE = withAdminAuth(async ({ req, user }) => {
  let body: unknown;
  try { body = await jsonRichiesta(req, TETTO_JSON); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }
  const id = (body as { id?: string })?.id;
  if (!id || !z.string().uuid().safeParse(id).success) return ApiErrors.invalidRequest('ID non valido');

  const admin = getAdminSupabase();
  // I vincoli del database NON proteggono: le sottocategorie si cancellano a
  // cascata e i prodotti perdono la categoria (migrations/002). Il controllo
  // che la risposta prometteva si fa qui, prima di cancellare.
  const { data: cat, error: eCat } = await admin.from('categories').select('id, name, slug').eq('id', id).maybeSingle();
  if (eCat) return ApiErrors.internal('Impossibile eliminare la categoria');
  if (!cat) return ApiErrors.notFound('Categoria non trovata');
  const [figli, prodotti] = await Promise.all([
    admin.from('categories').select('id', { count: 'exact', head: true }).eq('parent_id', id),
    admin.from('products').select('id', { count: 'exact', head: true }).eq('category_id', id),
  ]);
  if (figli.error || prodotti.error) return ApiErrors.internal('Non riesco a controllare se la categoria è usata: riprova');
  const nFigli = figli.count ?? 0;
  const nProdotti = prodotti.count ?? 0;
  if (nFigli > 0 || nProdotti > 0) {
    const pezzi = [
      nFigli > 0 ? `${nFigli} sottocategori${nFigli === 1 ? 'a' : 'e'}` : null,
      nProdotti > 0 ? `${nProdotti} prodott${nProdotti === 1 ? 'o' : 'i'}` : null,
    ].filter(Boolean).join(' e ');
    return ApiErrors.invalidRequest(`Categoria usata da ${pezzi}: spostali prima di eliminarla`);
  }
  const { error } = await admin.from('categories').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') return ApiErrors.invalidRequest('Categoria usata da prodotti o sottocategorie: non eliminabile');
    return ApiErrors.internal('Impossibile eliminare la categoria');
  }
  const c = cat as { name: string; slug: string };
  await writeAudit({ actorId: user.id, action: 'category.delete', targetTable: 'categories', targetId: id, metadata: { name: c.name, slug: c.slug } });
  return apiSuccess({ ok: true });
});

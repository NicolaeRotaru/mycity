import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { writeAudit } from '@/lib/audit';
import { fotoDiCategoria, motivoDaSegnalare } from '@/lib/immagine-categoria';

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
  // 28/11/2026 (R01-014, onda 2) — L'obbligo di allergeni e ingredienti (migrazione 363) per una
  // categoria che non si chiama «alimentari»: dal pannello non si poteva accendere su una radice nuova.
  // Spegnerlo dove è acceso lo rifiuta il database (categoria_alimentare_non_si_spegne).
  richiede_dichiarazioni_alimentari: z.boolean().optional(),
  // La foto della tessera in home (migrazione 159). Vuota = nessuna foto: si salva null. Il messaggio
  // è quello di fotoDiCategoria, cioè dice esattamente cosa la home accetta e cosa no.
  image_url: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .superRefine((v, ctx) => {
      if (!v) return;
      const motivo = motivoDaSegnalare(fotoDiCategoria({ image_url: v }));
      if (motivo) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Foto non ammessa: ${motivo}` });
    }),
};

const createSchema = z.object(baseFields);

/**
 * R01-014 (onda 2) — Un 23514 non è sempre la foto. Il grilletto della 363 rifiuta con un messaggio
 * scritto per chi amministra («Lo slug di «Alimentari» non si cambia: …»), e il pannello diceva
 * «Foto non ammessa». Il messaggio scritto da noi passa com'è; quello tecnico di un vincolo resta la foto
 * (gli unici CHECK della tabella sono quelli della foto, migrazione 159).
 */
function motivoDelRifiuto(error: { message?: string | null }): string {
  const testo = String(error.message ?? '').trim();
  if (testo && !/violates check constraint/i.test(testo)) return testo.slice(0, 300);
  return 'Foto non ammessa dal database: https://… oppure un percorso del sito /…';
}

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
      // Solo se è stata mandata: senza la migrazione 159 la colonna non c'è, e una categoria senza
      // foto si deve poter creare lo stesso.
      ...(d.image_url !== undefined ? { image_url: d.image_url || null } : {}),
      ...(d.richiede_dichiarazioni_alimentari !== undefined
        ? { richiede_dichiarazioni_alimentari: d.richiede_dichiarazioni_alimentari }
        : {}),
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return ApiErrors.invalidRequest('Slug già esistente');
    if (error.code === '23514') return ApiErrors.invalidRequest(motivoDelRifiuto(error));
    return ApiErrors.internal('Impossibile creare la categoria');
  }
  await writeAudit({
    actorId: user.id, action: 'category.create', targetTable: 'categories', targetId: data.id,
    metadata: { name: d.name, slug: d.slug, richiede_dichiarazioni_alimentari: d.richiede_dichiarazioni_alimentari ?? false },
  });
  return apiSuccess({ id: data.id });
});

/**
 * 28/11/2026 (R04-004) — IL RIFIUTO DELLA GUARDIA DEGLI ALLERGENI ARRIVA CON IL SUO MOTIVO.
 * La guardia della migrazione 363 (`categories`, BEFORE UPDATE OR DELETE) rifiuta con 23514 e una
 * frase scritta per chi amministra: «La categoria «Alimentari» non si cancella: da lei dipende
 * l'obbligo di allergeni e ingredienti». La cancellazione la trasformava in «Impossibile eliminare
 * la categoria» (500), la modifica in «Foto non ammessa dal database» (l'altro 23514, quello della
 * foto). Ora la frase del database passa com'è; ogni altro 23514 resta com'era.
 */
function rifiutoDellaGuardiaAllergeni(error: { code?: string; message?: string } | null): string | null {
  if (error?.code !== '23514') return null;
  const frase = (error.message ?? '').trim();
  return /allergeni e ingredienti/i.test(frase) ? frase : null;
}

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
  if (rest.image_url !== undefined) patch.image_url = rest.image_url || null;
  if (rest.richiede_dichiarazioni_alimentari !== undefined) {
    patch.richiede_dichiarazioni_alimentari = rest.richiede_dichiarazioni_alimentari;
  }
  if (Object.keys(patch).length === 0) return ApiErrors.invalidRequest('Nessun campo da aggiornare');

  const admin = getAdminSupabase();
  if (typeof rest.parent_id === 'string') {
    const no = await genitoreNonAmmesso(admin, id, rest.parent_id);
    if (no) return ApiErrors.invalidRequest(no);
  }
  const { error } = await admin.from('categories').update(patch).eq('id', id);
  if (error) {
    const guardia = rifiutoDellaGuardiaAllergeni(error);
    if (guardia) return ApiErrors.invalidRequest(guardia);
    if (error.code === '23505') return ApiErrors.invalidRequest('Slug già esistente');
    if (error.code === '23514') return ApiErrors.invalidRequest(motivoDelRifiuto(error));
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
    const guardia = rifiutoDellaGuardiaAllergeni(error);
    if (guardia) return ApiErrors.invalidRequest(guardia);
    if (error.code === '23503') return ApiErrors.invalidRequest('Categoria usata da prodotti o sottocategorie: non eliminabile');
    return ApiErrors.internal('Impossibile eliminare la categoria');
  }
  const c = cat as { name: string; slug: string };
  await writeAudit({ actorId: user.id, action: 'category.delete', targetTable: 'categories', targetId: id, metadata: { name: c.name, slug: c.slug } });
  return apiSuccess({ ok: true });
});

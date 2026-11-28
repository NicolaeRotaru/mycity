import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';
import { controllaScorteVarianti, saveProductVariantsServer } from '@/lib/products/persistVariantsServer';
import { DaCompletare, tracciaDellaModifica, type VoceDiTraccia } from '@/lib/products/salvataggio-tracciato';
import { type ProductVariant } from '@/lib/products/variants';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { colonnaNonTrovata } from '@/lib/db/migrazione-148';

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
  /** id variante → pezzi, com'erano all'apertura della scheda. */
  scorteViste: z.record(z.string(), z.number().int()).optional(),
  /** La scorta del prodotto com'era all'apertura: la condizione per scriverne una nuova. */
  stock_visto: z.number().int().optional(),
  ...productFields,
  ...externalFields,
}).partial({ name: true, price: true });

/**
 * Verifica che il seller esista e sia un venditore. Vale anche per il negozio
 * MyCity (5/11/2026): esiste solo se è stato lanciato il seed, e prima il suo id
 * passava senza controllo anche quando il profilo non c'era.
 */
async function assertSeller(admin: ReturnType<typeof getAdminSupabase>, sellerId: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('role').eq('id', sellerId).maybeSingle();
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

/**
 * R16-004 — Le varianti non sono passate: il prodotto torna com'era prima del
 * salvataggio. La scorta torna indietro solo se in banca dati c'è ancora quella
 * appena scritta (una vendita arrivata nel frattempo non si cancella).
 * Vero se il prodotto è tornato com'era (o non c'era niente da rimettere).
 */
async function rimettiComEra(
  admin: ReturnType<typeof getAdminSupabase>,
  id: string,
  prima: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Promise<boolean> {
  if (!prima) return true;
  let scrittura = admin.from('products').update(prima).eq('id', id);
  if (typeof patch.stock === 'number') scrittura = scrittura.eq('stock', patch.stock);
  const { data, error } = await scrittura.select('id');
  return !error && Array.isArray(data) && data.length > 0;
}

/** La scorta del prodotto non è più quella vista all'apertura: si ferma tutto e lo si dice. */
const scortaDelProdottoCambiata = (vista: number | undefined) =>
  ApiErrors.conflict(
    `La scorta è cambiata mentre la scheda era aperta: avevi davanti ${vista} pezzi. Riapri il prodotto, controlla il numero e salva di nuovo.`,
  );

/**
 * 27/11/2026 — La funzione del database che scrive prodotto e varianti in una transazione
 * (`salva_prodotto_e_varianti`, migrazioni 405 e 709) non c'è ancora: PostgREST risponde PGRST202,
 * Postgres 42883 che la nomina. Solo allora si torna al percorso in due passi. Un 42883 che nomina
 * un'altra funzione nasce DENTRO di lei: non si ripiega in silenzio, si dice l'errore.
 */
function salvataggioUnicoMancante(e: { code?: string; message?: string }): boolean {
  return e.code === 'PGRST202' || (e.code === '42883' && /salva_prodotto_e_varianti/.test(e.message ?? ''));
}

/** Gli errori della funzione nelle stesse risposte del percorso in due passi. Non è rimasto scritto niente. */
function rispostaDelSalvataggioUnico(e: { message?: string; details?: string }, vista: number | undefined) {
  if (e.message === 'scorta_prodotto_cambiata') return scortaDelProdottoCambiata(vista);
  if (e.message === 'scorta_variante_cambiata') {
    let d: { label?: unknown; vista?: unknown; adesso?: unknown } = {};
    try { d = JSON.parse(e.details ?? '{}'); } catch { /* il messaggio resta generico */ }
    const ora = typeof d.adesso === 'number' ? `ora sono ${d.adesso}` : 'nel frattempo è cambiata';
    // Lo stesso testo di lib/products/persistVariantsServer.ts: il motivo e cosa fare, non «Riprova».
    return ApiErrors.conflict(
      `La scorta di «${String(d.label ?? 'una variante')}» è cambiata mentre modificavi: avevi davanti ${Number(d.vista ?? 0)} pezzi, ${ora}. Riapri il prodotto, controlla il numero e salva di nuovo.`,
    );
  }
  if (e.message === 'prodotto_non_trovato') return ApiErrors.notFound('Prodotto non trovato');
  return ApiErrors.internal('Impossibile aggiornare il prodotto');
}

/**
 * R03-002 — Le taglie di un prodotto come stanno in banca dati, in una forma che si confronta:
 * in ordine di posizione, con nome, opzioni, scorta e la posizione letta. `null` se non si leggono.
 */
type Taglia = { label: unknown; options: unknown; stock: unknown };
type TagliaLetta = Taglia & { position: number };
const contenutoTaglia = (t: Taglia) => JSON.stringify([t.label, t.options, t.stock]);
async function taglieInBanca(admin: ReturnType<typeof getAdminSupabase>, id: string): Promise<TagliaLetta[] | null> {
  try {
    const { data, error } = await admin
      .from('product_variants')
      .select('id, options, label, stock, position')
      .eq('product_id', id);
    if (error || !Array.isArray(data)) return null;
    return (data as Array<Record<string, unknown>>)
      .slice()
      .map((r) => ({ label: r.label ?? null, options: r.options ?? null, stock: r.stock ?? null, position: Number(r.position ?? 0) }))
      // A parità di posizione l'ordine non dipende dall'id: solo per scrivere la traccia sempre uguale.
      .sort((a, b) => a.position - b.position || contenutoTaglia(a).localeCompare(contenutoTaglia(b)));
  } catch {
    return null;
  }
}
/** Le taglie come entrano nella traccia: nome, opzioni e scorta, nell'ordine letto. */
const taglieDellaTraccia = (l: TagliaLetta[] | null): Taglia[] | null =>
  l && l.map(({ label, options, stock }) => ({ label, options, stock }));

/**
 * R03-001 — Le taglie sono cambiate se cambia l'insieme (nome, opzioni, scorta) o se due taglie
 * con posizioni di prima DIVERSE arrivano in ordine inverso. Due taglie alla stessa posizione non
 * avevano un ordine: il salvataggio le riscrive 0..n-1 in un ordine qualunque e non è un riordino.
 */
function taglieCambiate(prima: TagliaLetta[], dopo: TagliaLetta[]): boolean {
  const insieme = (l: TagliaLetta[]) => JSON.stringify(l.map(contenutoTaglia).sort());
  if (insieme(prima) !== insieme(dopo)) return true;
  // Ogni taglia di dopo prende la posizione di prima della stessa taglia (due uguali: nell'ordine).
  const posizioniDiPrima = new Map<string, number[]>();
  for (const t of prima) posizioniDiPrima.set(contenutoTaglia(t), [...(posizioniDiPrima.get(contenutoTaglia(t)) ?? []), t.position]);
  const coppie = dopo.map((t) => ({ ora: t.position, prima: posizioniDiPrima.get(contenutoTaglia(t))?.shift() ?? 0 }));
  return coppie.some((a) => coppie.some((b) => a.ora < b.ora && a.prima > b.prima));
}

export const POST = withAdminAuth(async ({ user, req }) => {
  let body: unknown;
  try { body = await jsonRichiesta(req, TETTO_JSON); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }
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
  try { body = await jsonRichiesta(req, TETTO_JSON); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.issues[0]?.message ?? 'Dati non validi');
  const { id, variants, scorteViste, stock_visto: scortaVista, ...rest } = parsed.data;

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
  // 28/11/2026 (R01-010, onda 2) — Lo staff che rimette in vendita un prodotto tolto dopo una
  // segnalazione accolta svuota il segno nella stessa scrittura: il database non lascia tornare
  // «available» un prodotto col segno (migrazione 999k), nemmeno al server.
  if (rest.status === 'available') patch.tolto_dallo_staff_at = null;
  Object.assign(patch, externalPatch(rest));

  // 31/10/2026 — LA SCORTA SI SCRIVE SOLO SE E' ANCORA QUELLA VISTA. Con
  // `stock_visto` la scorta non toccata non parte, e quella cambiata va in
  // banca dati solo se nel frattempo nessun ordine l'ha abbassata.
  let condizione: number | undefined;
  if (patch.stock !== undefined && scortaVista !== undefined) {
    if (patch.stock === scortaVista) delete patch.stock;
    else condizione = scortaVista;
  }

  // R16-004 — TUTTO O NIENTE. Con le varianti, prima si guarda che le loro
  // scorte siano ancora quelle viste (se no non si scrive niente), e si legge
  // com'era il prodotto: se poi le varianti cadono, il prodotto torna così.
  let prima: Record<string, unknown> | null = null;
  // R02-003 — Com'era il prodotto si legge anche senza varianti: serve alla traccia, che dice
  // il valore di prima e quello di dopo di ogni campo cambiato, come le altre porte.
  if (Object.keys(patch).length > 0) {
    let { data, error } = await admin.from('products').select(Object.keys(patch).join(', ')).eq('id', id).maybeSingle();
    // Senza la migrazione 999k la colonna del segno non c'è: non c'è niente da svuotare.
    if (error && 'tolto_dallo_staff_at' in patch && colonnaNonTrovata(error, ['tolto_dallo_staff_at'])) {
      delete patch.tolto_dallo_staff_at;
      ({ data, error } = await admin.from('products').select(Object.keys(patch).join(', ')).eq('id', id).maybeSingle());
    }
    if (error) return ApiErrors.internal('Impossibile aggiornare il prodotto');
    prima = data as unknown as Record<string, unknown> | null;
    // R04-002 — Prodotto che non esiste: 404, niente scritture e niente traccia con «prima» vuoto.
    if (!prima) return ApiErrors.notFound('Prodotto non trovato');
  } else {
    const { data, error } = await admin.from('products').select('id').eq('id', id).maybeSingle();
    if (error) return ApiErrors.internal('Impossibile aggiornare il prodotto');
    if (!data) return ApiErrors.notFound('Prodotto non trovato');
  }

  // R03-002 — Com'erano le taglie prima del salvataggio: se cambiano (anche da sole) la traccia lo dice.
  const taglieDiPrima = variants ? await taglieInBanca(admin, id) : null;

  // 27/11/2026 — UNA SCRITTURA SOLA. Con le varianti, prodotto e varianti li scrive la funzione del
  // database in una transazione: una taglia venduta fra il controllo e la scrittura, o una scrittura
  // delle varianti che cade, non lascia più nome e prezzo scritti da soli. Le condizioni sulle
  // scorte viste sono le stesse, dentro la funzione, con le righe bloccate. Senza la funzione resta
  // il percorso di prima, in due passi con il ripristino.
  let salvatoInsieme = false;
  if (variants) {
    const { error } = await admin.rpc('salva_prodotto_e_varianti', {
      p_product_id: id,
      p_prodotto: patch,
      p_scorta_vista: condizione ?? null,
      p_varianti: variants.map((v) => ({ ...(v.id ? { id: v.id } : {}), options: v.options, label: v.label, stock: v.stock })),
      p_scorte_viste: scorteViste ?? null,
    });
    if (!error) salvatoInsieme = true;
    else if (!salvataggioUnicoMancante(error)) return rispostaDelSalvataggioUnico(error, condizione);
  }

  if (variants && !salvatoInsieme) {
    try {
      await controllaScorteVarianti(admin, id, variants as ProductVariant[], scorteViste);
    } catch (errore) {
      if (errore instanceof DaCompletare) return ApiErrors.conflict(errore.message);
      return ApiErrors.internal('Errore nel salvataggio delle varianti');
    }
  }
  if (!salvatoInsieme && Object.keys(patch).length > 0) {
    if (condizione === undefined) {
      const { error } = await admin.from('products').update(patch).eq('id', id);
      if (error) return ApiErrors.internal('Impossibile aggiornare il prodotto');
    } else {
      const { data, error } = await admin.from('products').update(patch).eq('id', id).eq('stock', condizione).select('id');
      if (error) return ApiErrors.internal('Impossibile aggiornare il prodotto');
      // Nessuna riga: in banca dati la scorta non e' piu' quella vista. Anche
      // quando c'e' gia' proprio il numero scritto: vista 5, venduta 1 online
      // (in banca 4), scritto 4 dopo un pezzo rotto e' una vendita da non
      // cancellare, non un salvataggio rimandato. Si ferma tutto e lo si dice;
      // il modulo riparte dalla banca dati.
      if (!data || data.length === 0) return scortaDelProdottoCambiata(condizione);
    }
  }

  if (variants && !salvatoInsieme) {
    try {
      await saveProductVariantsServer(admin, id, variants as ProductVariant[], scorteViste);
    } catch (errore) {
      const rimesso = await rimettiComEra(admin, id, prima, patch);
      const nota = rimesso ? '' : ' Le altre modifiche però sono rimaste salvate: riapri la scheda e controlla.';
      // La variante venduta mentre la scheda era aperta: il motivo, non «Riprova».
      if (errore instanceof DaCompletare) return ApiErrors.conflict(errore.message + nota);
      return ApiErrors.internal(`Errore nel salvataggio delle varianti.${nota}`);
    }
  }

  // R02-003 — La traccia «chi ha cambiato cosa» nella stessa forma del modulo del prodotto e delle
  // porte dell'AI (`tracciaDellaModifica`): solo i campi cambiati, col valore di prima e di dopo.
  // Il negozio e i dati esterni li cambia solo l'amministrazione: entrano nella stessa voce.
  let voce: VoceDiTraccia | null = tracciaDellaModifica({
    prodottoId: id,
    attoreId: user.id,
    origine: 'admin',
    prima: prima ?? {},
    dopo: patch,
    altreColonne: ['seller_id', 'external_source_url', 'external_marketplace', 'external_data'],
  });
  // R03-002 — Le taglie non sono colonne del prodotto: cambiate da sole, la voce non nasceva e il
  // registro restava muto. Entrano nella stessa voce come `variants`, prima e dopo come stanno in
  // banca dati, solo se cambiate davvero; se una delle due letture non riesce si scrive lo stesso
  // (con `null` dove non si sa), perché il salvataggio delle taglie c'è stato.
  if (variants) {
    const taglieDopo = await taglieInBanca(admin, id);
    if (taglieDiPrima === null || taglieDopo === null || taglieCambiate(taglieDiPrima, taglieDopo)) {
      const base: VoceDiTraccia = voce ?? {
        actorId: user.id,
        action: 'product.update',
        targetTable: 'products',
        targetId: id,
        metadata: { origine: 'admin', campi: [], prima: {}, dopo: {}, daAi: [] },
      };
      voce = {
        ...base,
        metadata: {
          ...base.metadata,
          campi: [...base.metadata.campi, 'variants'],
          prima: { ...base.metadata.prima, variants: taglieDellaTraccia(taglieDiPrima) },
          dopo: { ...base.metadata.dopo, variants: taglieDellaTraccia(taglieDopo) },
        },
      };
    }
  }
  if (voce) await writeAudit(voce);

  return apiSuccess({ ok: true });
});

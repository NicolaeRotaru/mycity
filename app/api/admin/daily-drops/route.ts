import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { DROP_DEL_GIORNO_ACCESO } from '@/lib/funzioni-al-lancio';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * POST/DELETE /api/admin/daily-drops
 * Gestione del "Drop del giorno" (tabella daily_drops). La lettura è pubblica
 * (RLS SELECT), ma la scrittura non ha policy: passa da qui (withAdminAuth +
 * service-role), come /api/admin/home.
 */

const dropSchema = z.object({
  product_id: z.string().uuid('Prodotto non valido'),
  drop_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida'),
  discount_percent: z.number().int().min(5).max(70),
  // I prezzi del browser si accettano ma NON si usano: il server li ricava dal
  // prezzo vero del prodotto e dallo sconto (prima si poteva salvare «prima 100 €,
  // -50%» su un prodotto da 20 €, o un drop più caro del prezzo pieno).
  original_price: z.number().positive().optional(),
  drop_price: z.number().positive().optional(),
  headline: z.string().trim().max(200).optional().or(z.literal('')),
  // Per sostituire il drop già programmato per quel giorno serve dirlo.
  sovrascrivi: z.boolean().optional(),
});

/** Il prezzo del drop: prezzo pieno meno lo sconto, arrotondato al centesimo. */
function prezzoDelDrop(prezzoPieno: number, scontoPercento: number): number {
  return Math.round(prezzoPieno * (100 - scontoPercento)) / 100;
}

export const POST = withAdminAuth(async ({ req, user }) => {
  // Spento al lancio (carta #209): si risponde prima di leggere il corpo. NB: se
  // manca la chiave di servizio la risposta è il 503 di withAdminAuth, che la
  // chiede per leggere il profilo di chi chiama: a questo freno non si arriva.
  // Il DELETE resta, per pulire.
  if (!DROP_DEL_GIORNO_ACCESO) {
    return ApiErrors.conflict('Il Drop del giorno è spento: la cassa non applica ancora il prezzo scontato.');
  }
  let body: unknown;
  try { body = await jsonRichiesta(req, TETTO_JSON); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }

  const parsed = dropSchema.safeParse(body);
  if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.issues[0]?.message ?? 'Dati non validi');
  const d = parsed.data;

  const admin = getAdminSupabase();
  // Il prodotto deve essere in vetrina: pubblicato e di un negozio approvato.
  const { data: prodotto, error: eProd } = await admin
    .from('products')
    .select('id, price, status, seller:profiles!products_seller_id_fkey ( is_approved, role )')
    .eq('id', d.product_id)
    .maybeSingle();
  if (eProd) return ApiErrors.internal('Impossibile controllare il prodotto');
  if (!prodotto) return ApiErrors.invalidRequest('Prodotto non trovato');
  const pr = prodotto as unknown as { price: number | string; status: string; seller: { is_approved: boolean | null; role: string | null } | null };
  if (pr.status !== 'available') return ApiErrors.invalidRequest('Il prodotto non è in vendita: non può andare in vetrina');
  if (!pr.seller || pr.seller.role !== 'seller' || pr.seller.is_approved !== true) {
    return ApiErrors.invalidRequest('Il negozio di questo prodotto non è approvato: non può andare in vetrina');
  }
  const prezzoPieno = Number(pr.price);
  if (!Number.isFinite(prezzoPieno) || prezzoPieno <= 0) return ApiErrors.invalidRequest('Il prodotto non ha un prezzo valido');
  const prezzoDrop = prezzoDelDrop(prezzoPieno, d.discount_percent);

  // Un drop per giorno: se c'è già, non lo si sovrascrive in silenzio.
  const { data: esistente, error: eEs } = await admin.from('daily_drops').select('id').eq('drop_date', d.drop_date).maybeSingle();
  if (eEs) return ApiErrors.internal('Impossibile salvare il drop');
  if (esistente && !d.sovrascrivi) {
    return ApiErrors.conflict('C’è già un drop per quel giorno: conferma per sostituirlo');
  }

  const { error } = await admin.from('daily_drops').upsert(
    {
      product_id: d.product_id,
      drop_date: d.drop_date,
      discount_percent: d.discount_percent,
      original_price: prezzoPieno,
      drop_price: prezzoDrop,
      headline: d.headline?.trim() || null,
    },
    { onConflict: 'drop_date' },
  );
  if (error) return ApiErrors.internal('Impossibile salvare il drop');
  await writeAudit({
    actorId: user.id,
    action: 'daily_drop.create',
    targetTable: 'daily_drops',
    targetId: d.drop_date,
    metadata: { product_id: d.product_id, discount_percent: d.discount_percent, drop_price: prezzoDrop, sostituito: Boolean(esistente) },
  });
  return apiSuccess({ ok: true, original_price: prezzoPieno, drop_price: prezzoDrop });
});

export const DELETE = withAdminAuth(async ({ req, user }) => {
  let body: unknown;
  try { body = await jsonRichiesta(req, TETTO_JSON); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }
  const date = (body as { drop_date?: string })?.drop_date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return ApiErrors.invalidRequest('Data non valida');

  const admin = getAdminSupabase();
  const { data: tolti, error } = await admin.from('daily_drops').delete().eq('drop_date', date).select('id, product_id');
  if (error) return ApiErrors.internal('Impossibile eliminare il drop');
  // Niente da cancellare non è un «fatto»: lo si dice.
  if (!tolti || (tolti as unknown[]).length === 0) return ApiErrors.notFound('Nessun drop per quella data');
  await writeAudit({
    actorId: user.id,
    action: 'daily_drop.delete',
    targetTable: 'daily_drops',
    targetId: date,
    metadata: { product_id: (tolti as Array<{ product_id: string }>)[0]?.product_id ?? null },
  });
  return apiSuccess({ ok: true });
});

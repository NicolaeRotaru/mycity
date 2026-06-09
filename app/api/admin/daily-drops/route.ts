import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';

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
  original_price: z.number().positive(),
  drop_price: z.number().positive(),
  headline: z.string().trim().max(200).optional().or(z.literal('')),
});

export const POST = withAdminAuth(async ({ req }) => {
  let body: unknown;
  try { body = await req.json(); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }

  const parsed = dropSchema.safeParse(body);
  if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.issues[0]?.message ?? 'Dati non validi');
  const d = parsed.data;

  const admin = getAdminSupabase();
  const { error } = await admin.from('daily_drops').upsert(
    {
      product_id: d.product_id,
      drop_date: d.drop_date,
      discount_percent: d.discount_percent,
      original_price: d.original_price,
      drop_price: d.drop_price,
      headline: d.headline?.trim() || null,
    },
    { onConflict: 'drop_date' },
  );
  if (error) return ApiErrors.internal('Impossibile salvare il drop');
  return apiSuccess({ ok: true });
});

export const DELETE = withAdminAuth(async ({ req }) => {
  let body: unknown;
  try { body = await req.json(); } catch { return ApiErrors.invalidRequest('Corpo della richiesta non valido'); }
  const date = (body as { drop_date?: string })?.drop_date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return ApiErrors.invalidRequest('Data non valida');

  const admin = getAdminSupabase();
  const { error } = await admin.from('daily_drops').delete().eq('drop_date', date);
  if (error) return ApiErrors.internal('Impossibile eliminare il drop');
  return apiSuccess({ ok: true });
});

import { withSellerAnchePendingRateLimit } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { pagella, type Lettura } from '@/lib/agenzia/pagella';

export const runtime = 'nodejs';

/**
 * LA PAGELLA DEL NEGOZIO — 24/11/2026. Nella pagina dell'analisi del business.
 *
 * Nicola: «fai la pagella del flusso 18 nella pagina dell'analisi». Qui si leggono le righe del negozio
 * (solo i campi che servono: stati, date, importi, foto; niente nomi, telefoni o indirizzi dei clienti)
 * e il calcolo lo fa `lib/agenzia/pagella.ts`, la stessa logica del flusso 18 di n8n.
 * Una lettura che non riesce diventa «non misurato», mai zero.
 */

const TETTO = 2000;
const TETTO_CONFRONTO = 5000;
const PREFISSO_DI_SISTEMA = '11111111-1111-1111-1111-';

type Esito<T> = { data: T[] | null; error: { message: string } | null; count?: number | null };
const lettura = <T,>(r: Esito<T>): Lettura<T> => (r.error ? null : { righe: r.data ?? [], ...(typeof r.count === 'number' ? { totale: r.count } : {}) });

export const GET = withSellerAnchePendingRateLimit({ name: 'seller-pagella', max: 20, windowMs: 60_000 }, async ({ user }) => {
  const admin = getAdminSupabase();
  const [profilo, prodotti, ordini, confronto] = await Promise.all([
    admin
      .from('profiles')
      .select('role, approval_status, approval_requested_at, approved_at, created_at, stripe_charges_enabled, stripe_payouts_enabled, store_logo, store_media, store_description, store_hours, store_address')
      .eq('id', user.id)
      .maybeSingle(),
    admin.from('products').select('id, status, images, price, stock', { count: 'exact' }).eq('seller_id', user.id).limit(TETTO),
    admin
      .from('orders')
      .select('payment_status, delivery_status, created_at, user_id, total_price, payment_method, payout_at, canceled_at', { count: 'exact' })
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false })
      .limit(TETTO),
    admin.from('products').select('seller_id').eq('status', 'available').neq('seller_id', user.id).limit(TETTO_CONFRONTO),
  ]);
  if (profilo.error) {
    logger.error('[pagella] profilo non letto', { userId: user.id, message: profilo.error.message });
    return ApiErrors.unavailable('Non sono riuscito a preparare la pagella. Riprova fra poco.');
  }
  if ((profilo.data as { role?: string } | null)?.role !== 'seller') return ApiErrors.forbidden('La pagella è dei negozi.');

  // Le recensioni sono dei prodotti: si leggono per i prodotti del negozio (al massimo i primi 500).
  const idProdotti = ((prodotti.data ?? []) as { id: string }[]).map((p) => p.id).slice(0, 500);
  const recensioni: Esito<{ rating: number | null }> = prodotti.error
    ? { data: null, error: { message: 'prodotti non letti' } }
    : idProdotti.length
      ? ((await admin.from('reviews').select('rating').in('product_id', idProdotti).limit(TETTO)) as Esito<{ rating: number | null }>)
      : { data: [], error: null };

  // I negozi di sistema (MyCity, SDG) non entrano nel confronto, come nel flusso 18.
  const confrontoPulito: Esito<{ seller_id: string | null }> = confronto.error
    ? { data: null, error: confronto.error }
    : { data: ((confronto.data ?? []) as { seller_id: string | null }[]).filter((r) => !String(r.seller_id ?? '').startsWith(PREFISSO_DI_SISTEMA)), error: null };

  const risultato = pagella({
    profilo: profilo.data as never,
    prodotti: lettura(prodotti as unknown as Esito<never>),
    ordini: lettura(ordini as unknown as Esito<never>),
    recensioni: lettura(recensioni),
    confronto: lettura(confrontoPulito),
    adesso: new Date(),
  });
  return apiSuccess(risultato, { headers: { 'Cache-Control': 'no-store' } });
});

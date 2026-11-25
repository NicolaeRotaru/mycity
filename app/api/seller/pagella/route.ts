import { withSellerAnchePendingRateLimit } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { pagella, type Lettura } from '@/lib/agenzia/pagella';
import { leggiSchedaEPagellaAperte } from '@/lib/agenzia/scheda-dopo-abbonamento';

export const runtime = 'nodejs';

/**
 * LA PAGELLA DEL NEGOZIO — 24/11/2026. Nella pagina dell'analisi del business.
 *
 * Nicola: «fai la pagella del flusso 18 nella pagina dell'analisi». Qui si leggono le righe del negozio
 * (solo i campi che servono: stati, date, importi, foto; niente nomi, telefoni o indirizzi dei clienti)
 * e il calcolo lo fa `lib/agenzia/pagella.ts`, la stessa logica del flusso 18 di n8n.
 * Una lettura che non riesce diventa «non misurato», mai zero.
 *
 * 25/11/2026 — Nicola: la pagella sul marketplace arriva solo dopo l'abbonamento. Per un negozio in demo
 * (mai pagato un abbonamento ai servizi e non già online prima della demo) la risposta è
 * `{ disponibile: false }`: la pagina non mostra il blocco (lib/agenzia/scheda-dopo-abbonamento.ts).
 */

const TETTO = 2000;
const TETTO_CONFRONTO = 5000;
const PREFISSO_DI_SISTEMA = '11111111-1111-1111-1111-';

type Esito<T> = { data: T[] | null; error: { message: string } | null; count?: number | null };
const lettura = <T,>(r: Esito<T>): Lettura<T> => (r.error ? null : { righe: r.data ?? [], ...(typeof r.count === 'number' ? { totale: r.count } : {}) });

export const GET = withSellerAnchePendingRateLimit({ name: 'seller-pagella', max: 20, windowMs: 60_000 }, async ({ user }) => {
  const admin = getAdminSupabase();
  const [profilo, prodotti, ordini, confronto, recensioni] = await Promise.all([
    admin
      .from('profiles')
      .select('role, approval_status, approval_requested_at, approved_at, created_at, stripe_charges_enabled, stripe_payouts_enabled, store_logo, store_media, store_description, store_hours, store_address')
      .eq('id', user.id)
      .maybeSingle(),
    admin.from('products').select('status, images, price, stock', { count: 'exact' }).eq('seller_id', user.id).limit(TETTO),
    admin
      .from('orders')
      .select('payment_status, delivery_status, created_at, user_id, total_price, payment_method, payout_at, canceled_at, delivered_at', { count: 'exact' })
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false })
      .limit(TETTO),
    admin.from('products').select('seller_id', { count: 'exact' }).eq('status', 'available').neq('seller_id', user.id).limit(TETTO_CONFRONTO),
    // Le recensioni del negozio (store_reviews): quelle che il titolare vede e a cui risponde, come nel flusso 18.
    admin.from('store_reviews').select('rating', { count: 'exact' }).eq('store_id', user.id).limit(TETTO),
  ]);
  if (profilo.error) {
    logger.error('[pagella] profilo non letto', { userId: user.id, message: profilo.error.message });
    return ApiErrors.unavailable('Non sono riuscito a preparare la pagella. Riprova fra poco.');
  }
  if ((profilo.data as { role?: string } | null)?.role !== 'seller') return ApiErrors.forbidden('La pagella è dei negozi.');
  // 25/11/2026 — Prima dell'abbonamento niente pagella (Nicola): la pagina non mostra il blocco.
  if (!(await leggiSchedaEPagellaAperte(admin, user.id))) {
    return apiSuccess({ disponibile: false as const }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // I negozi di sistema (MyCity, SDG) non entrano nel confronto, come nel flusso 18. Se le righe sono più
  // del tetto, il conteggio è parziale e la pagella lo dice.
  const righeConfronto = ((confronto.data ?? []) as { seller_id: string | null }[]);
  const confrontoPulito: Esito<{ seller_id: string | null }> = confronto.error
    ? { data: null, error: confronto.error }
    : {
        data: righeConfronto.filter((r) => !String(r.seller_id ?? '').startsWith(PREFISSO_DI_SISTEMA)),
        error: null,
        count: typeof confronto.count === 'number' && confronto.count > righeConfronto.length ? confronto.count : null,
      };

  const risultato = pagella({
    profilo: profilo.data as never,
    prodotti: lettura(prodotti as unknown as Esito<never>),
    ordini: lettura(ordini as unknown as Esito<never>),
    recensioni: lettura(recensioni as unknown as Esito<never>),
    confronto: lettura(confrontoPulito),
    adesso: new Date(),
  });
  return apiSuccess(risultato, { headers: { 'Cache-Control': 'no-store' } });
});

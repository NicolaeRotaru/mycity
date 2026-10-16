import { z } from 'zod';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors, apiError, apiSuccess } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { isStripeConfigured } from '@/lib/stripe/client';
import { logger } from '@/lib/logger';
import { carrelliDaDividere, dividiIlRimborso } from '@/lib/stripe/rimborsi-da-dividere';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/admin/orders/rimborsi-da-dividere
 *
 * 16/10/2026 — Un rimborso fatto dal cruscotto Stripe su un carrello di più
 * negozi ferma i bonifici di tutto il carrello, perché Stripe non dice di quale
 * negozio è. Prima si sbloccavano solo scrivendo nel database. Adesso:
 *  · GET  — i carrelli fermi, con quanto c'è da dividere e gli ordini (più
 *           quelli che Stripe in quel momento non ha lasciato leggere);
 *  · POST — la divisione decisa da chi amministra: registra la parte di ogni
 *           ordine (quota del negozio compresa) e riapre i bonifici.
 * La logica sta in lib/stripe/rimborsi-da-dividere.ts; le regole su quello che
 * si scrive in lib/rimborsi/divisione-del-rimborso.ts.
 */
export const GET = withAdminAuth(async () => {
  if (!isStripeConfigured()) return ApiErrors.unavailable('Stripe non configurato');
  try {
    // `nonLetti`: i pagamenti che Stripe adesso non lascia leggere. Restano a
    // parte, e gli altri carrelli si dividono lo stesso.
    return apiSuccess(await carrelliDaDividere());
  } catch (err) {
    logger.error('[rimborso da dividere] elenco non letto', { message: err instanceof Error ? err.message : String(err) });
    return ApiErrors.internal('Non riesco a leggere i rimborsi da dividere: riprova fra poco.');
  }
});

const Corpo = z.object({
  pagamento: z.string().min(3).max(200),
  parti: z
    .array(z.object({ ordine: z.string().min(1).max(100), centesimi: z.number().int().min(0) }))
    .min(1)
    .max(50),
});

export const POST = withAdminAuth(async ({ req, user }) => {
  if (!isStripeConfigured()) return ApiErrors.unavailable('Stripe non configurato');
  let corpo: z.infer<typeof Corpo>;
  try {
    corpo = Corpo.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }
  try {
    const esito = await dividiIlRimborso(corpo.pagamento, corpo.parti, user.id);
    if (!esito.ok) return apiError(esito.stato, esito.errore, esito.stato === 400 ? 'INVALID_REQUEST' : 'CONFLICT', { registrati: esito.registrati });
    return apiSuccess({ registrati: esito.registrati });
  } catch (err) {
    logger.error('[rimborso da dividere] divisione non riuscita', { message: err instanceof Error ? err.message : String(err) });
    return ApiErrors.internal('La divisione non è riuscita: ricarica la pagina e riprova.');
  }
});

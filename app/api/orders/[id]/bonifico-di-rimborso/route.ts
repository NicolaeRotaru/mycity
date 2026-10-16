import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { colonnaNonTrovata } from '@/lib/db/migrazione-148';
import { tabellaDeiBonificiMancante } from '@/lib/rimborsi/bonifici-da-fare';
import {
  ilBonificoCheIlClienteAspetta,
  type RigaDelReclamoDelCliente,
  type RigaDelResoDelCliente,
} from '@/lib/rimborsi/bonifico-del-cliente';

export const runtime = 'nodejs';

/**
 * IL BONIFICO DI RIMBORSO CHE IL CLIENTE ASPETTA (riesame del 16/10, quarto giro).
 *
 * La pagina dell'ordine diceva «Ordine rimborsato.» appena il rimborso di un ordine in contanti
 * era deciso, anche se il bonifico — che si fa a mano — non era ancora partito, e anche se ci
 * mancava l'IBAN. Lo stato del bonifico pero' sta in posti che il browser non legge: il «fatto»
 * e l'IBAN del reso (l'IBAN lo legge solo il server, 162) e la riga del bonifico di un reclamo
 * (solo server). Questa rotta li legge per il cliente dell'ordine e gli restituisce solo il conto:
 * quanto deve ancora arrivare e se ci serve l'IBAN. Mai l'IBAN.
 *
 * La regola sta in lib/rimborsi/bonifico-del-cliente.ts.
 */
export const GET = withAuth(async ({ user, params }): Promise<NextResponse> => {
  const orderId = String(params.id ?? '');
  const admin = getAdminSupabase();

  const { data: ordine, error } = await admin
    .from('orders')
    .select('id, user_id, payment_method, stripe_refund_id')
    .eq('id', orderId)
    .maybeSingle();
  if (error) {
    logger.error('[bonifico del cliente] ordine non letto', { orderId, message: error.message });
    return ApiErrors.internal("Non riesco a leggere l'ordine");
  }
  const o = ordine as { id: string; user_id: string | null; stripe_refund_id: string | null } | null;
  // Un ordine di un altro e' un ordine che non c'e'.
  if (!o || o.user_id !== user.id) return ApiErrors.notFound('Ordine non trovato');

  let con162 = true;
  const resi = await admin
    .from('returns')
    .select('id, refund_bonifico_fatto_at, refund_iban')
    .eq('order_id', orderId);
  if (resi.error && !colonnaNonTrovata(resi.error)) {
    logger.error('[bonifico del cliente] resi non letti', { orderId, message: resi.error.message });
    return ApiErrors.internal('Non riesco a leggere i resi');
  }
  if (resi.error) con162 = false;

  let reclami: RigaDelReclamoDelCliente[] = [];
  const bonificiDeiReclami = await admin
    .from('bonifici_dei_reclami')
    .select('dispute_id, fatto_at, iban')
    .eq('order_id', orderId);
  if (bonificiDeiReclami.error) {
    if (!tabellaDeiBonificiMancante(bonificiDeiReclami.error)) {
      logger.error('[bonifico del cliente] bonifici dei reclami non letti', {
        orderId, message: bonificiDeiReclami.error.message,
      });
      return ApiErrors.internal('Non riesco a leggere i bonifici');
    }
    con162 = false;
  } else {
    reclami = (bonificiDeiReclami.data ?? []) as unknown as RigaDelReclamoDelCliente[];
  }

  const bonifico = ilBonificoCheIlClienteAspetta({
    ordine: o,
    resi: (resi.error ? [] : (resi.data ?? [])) as unknown as RigaDelResoDelCliente[],
    reclami,
    con162,
  });
  return NextResponse.json(bonifico, { status: 200 });
});

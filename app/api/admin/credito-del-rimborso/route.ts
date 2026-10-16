import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import {
  attesoDallIndirizzo,
  MOTIVO_DEL_CREDITO_DEL_RIMBORSO,
  verdettoDelCredito,
} from '@/lib/rimborsi/credito-da-controllare';

export const runtime = 'nodejs';

/**
 * IL CONTROLLO DEL CREDITO DI UN RIMBORSO (riesame del 16/10, quarto giro).
 *
 * L'avviso «Rimborso col credito da controllare» chiedeva di guardare una riga del diario del
 * credito che nessuna pagina del pannello mostrava. Questa rotta la legge — per riferimento, con
 * il motivo dei rimborsi in contanti — insieme al saldo del cliente, e dice se la cifra torna con
 * quella del rimborso registrato (lib/rimborsi/credito-da-controllare.ts).
 *
 * Solo amministratori. Sola lettura.
 */
export const GET = withAdminAuth(async ({ req }): Promise<NextResponse> => {
  const url = new URL(req.url);
  const ref = (url.searchParams.get('ref') ?? '').trim();
  if (!ref || ref.length > 200) return ApiErrors.invalidRequest('Manca il riferimento del rimborso.');
  const atteso = attesoDallIndirizzo(url.searchParams.get('atteso'));

  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from('wallet_ledger')
    .select('id, user_id, delta_cents, created_at')
    .eq('reason', MOTIVO_DEL_CREDITO_DEL_RIMBORSO)
    .eq('ref', ref)
    .limit(10);
  if (error) {
    logger.error('[credito del rimborso] diario non letto', { ref, message: error.message });
    return ApiErrors.internal('Il diario del credito non risponde: riprova tra poco.');
  }
  const righe = (data ?? []) as Array<{ id: string; user_id: string; delta_cents: number | null; created_at: string | null }>;

  // Il saldo del cliente: utile a chi controlla, ma non necessario al verdetto.
  let saldoCents: number | null = null;
  const cliente = righe[0]?.user_id;
  if (cliente) {
    const profilo = await admin.from('profiles').select('wallet_balance_cents').eq('id', cliente).maybeSingle();
    if (profilo.error) {
      logger.warn('[credito del rimborso] saldo del cliente non letto', { message: profilo.error.message });
    } else {
      const v = (profilo.data as { wallet_balance_cents?: number | null } | null)?.wallet_balance_cents;
      saldoCents = v == null ? null : Math.round(Number(v));
    }
  }

  return NextResponse.json(
    { ref, attesoCents: atteso, righe, saldoCents, verdetto: verdettoDelCredito(righe, atteso) },
    { status: 200 },
  );
});

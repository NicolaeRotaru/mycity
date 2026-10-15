import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { conRipiegoSchema, senzaColonne } from '@/lib/db/migrazione-124';
import { colonnaNonTrovata } from '@/lib/db/migrazione-148';
import { COLONNE_162 } from '@/lib/rimborsi/scelta-del-cliente';
import {
  tabellaDeiBonificiMancante,
  vociDeiBonificiDaFare,
  type RigaDelBonificoDelReclamo,
  type RigaDelReso,
} from '@/lib/rimborsi/bonifici-da-fare';

export const runtime = 'nodejs';

/**
 * I BONIFICI DI RIMBORSO DA FARE (R71).
 *
 * Il rimborso di un reso pagato in contanti va col bonifico, salvo che il
 * cliente abbia scelto il credito MyCity. Il bonifico lo fa a mano chi
 * amministra: questa rotta gli da' la lista — con l'IBAN, che e' un dato
 * personale e per questo non lo legge nessun browser direttamente (migrazione
 * 162) — e il comando per segnarne uno come fatto.
 *
 * Collaudo del 15/10 — anche i bonifici dei reclami (`bonifici_dei_reclami`,
 * 162): prima la lista leggeva solo i resi, e il bonifico promesso dopo un
 * reclamo viveva solo nell'avviso della campanella.
 *
 * Solo amministratori. L'IBAN esce solo da qui.
 */
const COLONNE =
  'id, order_id, refund_amount_cents, refunded_at, refund_id, refund_iban, refund_bonifico_cents, refund_bonifico_fatto_at';

async function elenco(): Promise<NextResponse> {
  const admin = getAdminSupabase();
  let con162 = true;
  const leggi = (colonne: string) =>
    admin
      .from('returns')
      .select(colonne)
      .eq('status', 'REFUNDED')
      .like('refund_id', 'bonifico:%')
      .order('refunded_at', { ascending: false })
      .limit(200);
  const { data, error } = await conRipiegoSchema(
    'returns.select (bonifici da fare)',
    () => leggi(COLONNE),
    () => {
      // Senza la 162 la lista c'e' lo stesso, senza IBAN e senza «fatto».
      con162 = false;
      return leggi(senzaColonne(COLONNE, COLONNE_162));
    },
  );
  if (error) {
    logger.error('[bonifici da fare] lettura fallita', { message: (error as { message?: string }).message });
    return ApiErrors.internal('Non riesco a leggere i bonifici da fare');
  }

  // I bonifici dei reclami: senza la 162 la tabella non c'e', e quei bonifici
  // restano solo negli avvisi (la pagina lo dice).
  let reclami: RigaDelBonificoDelReclamo[] = [];
  const letturaReclami = await admin
    .from('bonifici_dei_reclami')
    .select('dispute_id, order_id, importo_cents, registrato_at, fatto_at')
    .order('registrato_at', { ascending: false })
    .limit(200);
  if (letturaReclami.error) {
    if (tabellaDeiBonificiMancante(letturaReclami.error)) {
      con162 = false;
    } else {
      logger.error('[bonifici da fare] lettura dei reclami fallita', { message: letturaReclami.error.message });
      return ApiErrors.internal('Non riesco a leggere i bonifici dei reclami');
    }
  } else {
    reclami = (letturaReclami.data ?? []) as unknown as RigaDelBonificoDelReclamo[];
  }

  const voci = vociDeiBonificiDaFare((data ?? []) as unknown as RigaDelReso[], reclami);
  return NextResponse.json({ voci, migrazione162: con162 }, { status: 200 });
}

/** Un bonifico si segna per il reso o per il reclamo da cui viene: uno dei due. */
const Body = z
  .object({ resoId: z.string().uuid().optional(), reclamoId: z.string().uuid().optional() })
  .refine((b) => !!b.resoId !== !!b.reclamoId, { message: 'Indica il reso oppure il reclamo' });

async function segnaFatto(req: NextRequest, user: { id: string }): Promise<NextResponse> {
  let body;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  const admin = getAdminSupabase();
  const adesso = new Date().toISOString();
  const { data, error } = body.reclamoId
    ? await admin
        .from('bonifici_dei_reclami')
        .update({ fatto_at: adesso })
        .eq('dispute_id', body.reclamoId)
        .is('fatto_at', null)
        .select('dispute_id')
    : await admin
        .from('returns')
        .update({ refund_bonifico_fatto_at: adesso })
        .eq('id', body.resoId as string)
        .eq('status', 'REFUNDED')
        .like('refund_id', 'bonifico:%')
        .is('refund_bonifico_fatto_at', null)
        .select('id');

  if (error) {
    if (colonnaNonTrovata(error) || tabellaDeiBonificiMancante(error)) {
      return ApiErrors.conflict(
        'Per segnare i bonifici fatti serve la migrazione 162 sul database: finché non c’è, tieni il conto a parte.',
      );
    }
    logger.error('[bonifici da fare] segno non scritto', {
      resoId: body.resoId, reclamoId: body.reclamoId, message: error.message,
    });
    return ApiErrors.internal('Non riesco a segnare il bonifico come fatto');
  }
  if (!data || data.length === 0) {
    return ApiErrors.conflict('Questo bonifico è già segnato come fatto, oppure non è un rimborso da bonificare.');
  }

  // Chi ha segnato il bonifico come fatto resta scritto: sono soldi usciti a mano.
  await writeAudit({
    actorId: user.id,
    action: 'order.refund',
    targetTable: body.reclamoId ? 'disputes' : 'returns',
    targetId: (body.reclamoId ?? body.resoId) as string,
    metadata: { passo: 'bonifico_di_rimborso_fatto' },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

export const GET = withAdminAuth(() => elenco());
export const POST = withAdminAuth(({ req, user }) => segnaFatto(req, user));

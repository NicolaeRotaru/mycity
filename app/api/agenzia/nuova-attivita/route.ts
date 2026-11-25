import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta } from '@/lib/api/corpo';
import { portaColSegreto } from '@/lib/api/porta-col-segreto';
import { logger } from '@/lib/logger';
import { NuovaAttivitaInArrivo, iscriviAttivita } from '@/lib/agenzia/nuova-attivita';

export const runtime = 'nodejs';

/**
 * IL MODULO 12 DI N8N ISCRIVE UN CLIENTE NUOVO IN MYCITY — 25/11/2026.
 *
 * Nicola compila il modulo 12 («nuovo cliente»), n8n fa POST qui e il negozio nasce come Ora del Gusto:
 * senza accesso, fuori vetrina, col suo link col codice in Admin → Preventivi col link. Nessuna email,
 * nessun messaggio al titolare: il link lo manda Nicola. Rimandare lo stesso nome e città non crea un
 * secondo negozio.
 *
 * La porta è quella in cui il sito si fida di n8n, quindi usa lo stesso segreto della scheda
 * (`N8N_SCHEDA_CLIENTE_SEGRETO`, intestazione `x-mycity-segreto`). Senza segreto resta chiusa (503).
 */

const TETTO = 8 * 1024;

const porta = (req: Request) =>
  portaColSegreto(req, { segreto: process.env.N8N_SCHEDA_CLIENTE_SEGRETO, nome: 'nuova-attivita', max: 20 });

export async function POST(req: Request): Promise<NextResponse> {
  const chiusa = await porta(req);
  if (chiusa) return chiusa;

  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Corpo non leggibile');
  }
  const esito = NuovaAttivitaInArrivo.safeParse(corpo);
  if (!esito.success) {
    const primo = esito.error.issues[0];
    return ApiErrors.invalidRequest(`Attività non valida: ${primo?.path.join('.') || 'corpo'} — ${primo?.message ?? ''}`.trim());
  }

  const fatto = await iscriviAttivita(getAdminSupabase(), esito.data);
  if (!fatto.ok) {
    if (fatto.motivo === 'gia-con-accesso') {
      return NextResponse.json({ ok: false, error: { code: 'GIA_ATTIVA', message: 'Questa attività ha già accettato il preventivo: il modulo non la riscrive.' } }, { status: 409 });
    }
    logger.error('[nuova-attivita] iscrizione non riuscita', { dettaglio: fatto.dettaglio });
    return ApiErrors.unavailable('Non sono riuscito a iscrivere l’attività. Riprova fra poco.');
  }
  logger.info('[nuova-attivita] attività iscritta', { id: fatto.id, nuova: fatto.nuova });
  return NextResponse.json({ ok: true, id_attivita: fatto.id, nuova: fatto.nuova }, { status: fatto.nuova ? 201 : 200 });
}

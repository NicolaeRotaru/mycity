import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { comunicaEsito } from './comunica';

export const runtime = 'nodejs';

/**
 * POST /api/segnalazioni/esito — solo amministratori.
 *
 * Manda l'esito motivato di una segnalazione gia' decisa a chi l'ha fatta e al
 * venditore (vedi `comunica.ts`). La pagina /admin/segnalazioni la chiama dopo
 * aver salvato la decisione. Risponde 502 se un canale previsto e' fallito,
 * cosi' l'amministratore lo vede invece di credere che sia partito.
 */
const Corpo = z.object({ id: z.string().uuid() });

export const POST = withAdminAuth(async ({ req }) => {
  let corpo;
  try {
    corpo = Corpo.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }
  const r = await comunicaEsito(getAdminSupabase(), corpo.id);
  if (!r.ok) {
    if (r.motivo === 'non_trovata') return ApiErrors.notFound('Segnalazione non trovata');
    if (r.motivo === 'non_decisa') return ApiErrors.conflict('Prima registra la decisione e una motivazione di almeno 20 caratteri');
    return ApiErrors.internal('Segnalazione non letta: riprova');
  }
  const { segnalanteEmail, segnalanteNotifica, venditore } = r;
  const fallito = [segnalanteEmail, segnalanteNotifica, venditore].includes('fallita');
  return NextResponse.json(
    { ok: !fallito, segnalanteEmail, segnalanteNotifica, venditore },
    { status: fallito ? 502 : 200 },
  );
});

import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { leggiIncassiDaDichiarare } from '@/lib/rider/leggi-incassi-da-dichiarare';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 15/10/2026 (R33) — Le consegne in contanti che il fattorino ha chiuso senza
 * dichiarare l'incasso. Le legge la sua bacheca, per rimettergliele davanti
 * finche' non le conferma: senza, il negozio non viene pagato. Ognuno vede
 * solo le sue: il filtro e' sull'utente collegato, non su un parametro.
 */
export const GET = withAuth(async ({ user }): Promise<NextResponse> => {
  const esito = await leggiIncassiDaDichiarare(getAdminSupabase(), user.id);
  if (!esito.ok) {
    logger.error('[rider] incassi da dichiarare: lettura non riuscita', { motivo: esito.motivo });
    return ApiErrors.internal('Non riesco a leggere gli incassi da confermare');
  }
  return NextResponse.json({ incassi: esito.incassi }, { status: 200 });
});

// Le rotte della pagina dell'agente: account collegato, agente attivo (o admin), un freno per non consumare le
// corse dell'AD (40 al giorno, insieme agli altri flussi n8n).

import type { NextResponse } from 'next/server';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { puoUsareLaScheda } from './inviti';

type Contesto = Parameters<Parameters<typeof withAuthRateLimit>[1]>[0];
type Gestore = (c: Contesto & { email: string }) => Promise<NextResponse>;

export function conAgente(freno: { name: string; max: number; windowMs: number }, gestore: Gestore) {
  return withAuthRateLimit(freno, async (c) => {
    const email = (c.user.email ?? '').toLowerCase();
    if (!email) return ApiErrors.forbidden('Questa pagina è per gli agenti di MyCity.');
    let puo = false;
    try {
      puo = await puoUsareLaScheda(c.user.id, c.profile?.role);
    } catch (errore) {
      logger.error('[agente] controllo non riuscito', { errore: String(errore) });
      return ApiErrors.unavailable('Non riesco a controllare il tuo accesso. Controlla che la migrazione 865 sia applicata, o riprova fra poco.');
    }
    if (!puo) return ApiErrors.forbidden('Questa pagina è per gli agenti di MyCity. Si entra col link d’invito che dà Nicola.');
    return gestore({ ...c, email });
  });
}

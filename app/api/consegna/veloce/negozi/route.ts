import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { getClientIp, rateLimitAsync } from '@/lib/rate-limit';
import { romeNow } from '@/lib/store-hours';
import { contaFattoriniOnline, veloceSiPuo, type EsitoVeloce } from '@/lib/ordini/consegna-veloce';

/**
 * GET /api/consegna/veloce/negozi?negozi=<id>,<id>,… — la consegna veloce di OGNI negozio di una
 * lista, con una domanda sola.
 *
 * 20/11/2026 (R02-018) — L'elenco dei negozi (e le altre liste di schede) chiedeva
 * /api/consegna/veloce una volta per scheda: duecento schede, duecento domande, e tutte contro lo
 * stesso freno per indirizzo del carrello. Quella rotta però risponde UN sì o no per tutti i negozi
 * insieme (è la domanda del carrello: «posso consegnare adesso tutto questo?»), e unire lì le domande
 * avrebbe dato a ogni scheda il verdetto di tutta la lista. Qui la risposta è una mappa: per ogni
 * negozio il SUO esito, con la stessa regola (`veloceSiPuo` con quel negozio solo), le stesse letture
 * (negozi approvati, fattorini online, una volta per tutti) e lo stesso «non so» (503) se una
 * lettura cade. Chi la chiama: `useVeloceDelNegozio` in components/ui/DeliveryCutoff.tsx, che
 * raccoglie le schede che chiedono nello stesso giro.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Una pagina di negozi intera (/stores e /near ne mostrano fino a 200) in due domande. */
const MAX_NEGOZI = 100;
/** Una lista è una domanda (o due) a ogni apertura: 30 al minuto per indirizzo bastano. Freno suo,
 *  separato da quello del carrello: una lista lunga non toglie domande alla cassa. */
const FRENO = { max: 30, windowMs: 60_000 } as const;
const NON_ACCETTA: EsitoVeloce = {
  possibile: false,
  perche: 'Il negozio non accetta ordini in questo momento: la consegna veloce non si può.',
};

type Risposta = { esiti: Record<string, EsitoVeloce> };

function rispondi(corpo: Risposta, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(corpo, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
}

export async function GET(req: Request) {
  const ip = getClientIp(req);
  const rl = await rateLimitAsync({ key: `consegna-veloce-negozi:${ip}`, ...FRENO });
  if (!rl.allowed) return rispondi({ esiti: {} }, 429, { 'Retry-After': String(rl.retryAfterSec) });
  const ids = Array.from(
    new Set(
      (new URL(req.url).searchParams.get('negozi') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
  if (ids.length === 0 || ids.length > MAX_NEGOZI || ids.some((id) => !UUID.test(id))) {
    return rispondi({ esiti: {} }, 400);
  }
  try {
    const admin = getAdminSupabase();
    const { data, error } = await admin
      .from('profiles')
      .select('id, store_name, store_hours')
      .eq('role', 'seller')
      .eq('is_approved', true)
      .in('id', ids);
    if (error || !data) {
      logger.error('consegna veloce (lista): orari dei negozi non letti', { error: error?.message, chiesti: ids.length });
      return rispondi({ esiti: {} }, 503);
    }
    const fattoriniOnline = await contaFattoriniOnline(admin);
    if (fattoriniOnline === null) {
      logger.error('consegna veloce (lista): fattorini online non letti');
      return rispondi({ esiti: {} }, 503);
    }
    const adesso = romeNow();
    const perId = new Map(
      (data as Array<{ id: string; store_name: string | null; store_hours: unknown }>).map((p) => [p.id, p]),
    );
    const esiti: Record<string, EsitoVeloce> = {};
    for (const id of ids) {
      const p = perId.get(id);
      esiti[id] = p
        ? veloceSiPuo({ adesso, negozi: [{ nome: p.store_name ?? 'Il negozio', orari: p.store_hours }], fattoriniOnline })
        : NON_ACCETTA;
    }
    return rispondi({ esiti });
  } catch (e) {
    logger.error('consegna veloce (lista): verifica non riuscita', { error: e instanceof Error ? e.message : String(e) });
    return rispondi({ esiti: {} }, 503);
  }
}

import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { getClientIp, rateLimitAsync } from '@/lib/rate-limit';
import { romeNow } from '@/lib/store-hours';
import { contaFattoriniOnline, veloceSiPuo, type EsitoVeloce } from '@/lib/ordini/consegna-veloce';

/**
 * GET /api/consegna/veloce?negozi=<id>,<id> — la cassa e il carrello chiedono qui se possono
 * offrire «Adesso». La decisione è `veloceSiPuo`, la stessa delle due rotte che creano l'ordine.
 * Risponde solo sì/no e il perché: nessun dato dei fattorini esce da qui.
 *
 * 29/10/2026 — Era pubblica senza freno, e leggeva `profiles` su qualunque id: con l'uuid di un
 * cliente rispondeva diverso che con un uuid inesistente. Adesso ha un limite di richieste per
 * indirizzo (la rotta serve anche a chi non ha fatto l'accesso, quindi niente `withAuthRateLimit`)
 * e legge solo negozi approvati: un id che non è un negozio pubblico vale come uno che non esiste.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NEGOZI = 20;
/** Il carrello chiede una volta al minuto e la cassa a ogni cambio: 30 al minuto bastano a tutti. */
const FRENO = { max: 30, windowMs: 60_000 } as const;
/**
 * 12/11/2026 (R10-006) — IL FRENO DA 30 SI CONTA PER INDIRIZZO *E* PER NEGOZI CHIESTI.
 *
 * Ogni scheda dell'elenco dei negozi chiede la veloce del suo negozio (useVeloceDelNegozio):
 * con piu' di 30 negozi la sola lista consumava le 30 domande al minuto dell'indirizzo, e il
 * carrello e la cassa ricevevano 429 → «Adesso non riesco a confermare la consegna veloce».
 * Adesso le stesse domande ripetute (lo stesso carrello, la stessa scheda) hanno ancora 30 al
 * minuto, ma una lista lunga non toglie niente al carrello. Contro chi gira gli id per
 * aggirarlo resta un tetto per indirizzo, piu' largo. ATTENZIONE: e' una cura a meta'. Il tetto
 * e' condiviso col carrello, e /stores e /near mostrano fino a 200 schede: lì il carrello puo'
 * ancora ricevere 429. La cura vera — una domanda sola per tutta la lista — andrebbe fatta nel
 * gancio (components/ui/DeliveryCutoff.tsx, useVeloceDelNegozio), che oggi chiede ancora un
 * negozio per volta.
 */
const TETTO_PER_INDIRIZZO = { max: 120, windowMs: 60_000 } as const;
const NON_RIESCO: EsitoVeloce = {
  possibile: false,
  perche: 'Adesso non riesco a confermare la consegna veloce. Scegli una fascia oraria.',
};

function rispondi(esito: EsitoVeloce, status = 200) {
  return NextResponse.json(esito, { status, headers: { 'Cache-Control': 'no-store' } });
}

function frenato(retryAfterSec: number) {
  return NextResponse.json(NON_RIESCO, {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retryAfterSec) },
  });
}

export async function GET(req: Request) {
  const ip = getClientIp(req);
  const tetto = await rateLimitAsync({ key: `consegna-veloce-tetto:${ip}`, ...TETTO_PER_INDIRIZZO });
  if (!tetto.allowed) return frenato(tetto.retryAfterSec);
  const ids = Array.from(
    new Set(
      (new URL(req.url).searchParams.get('negozi') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
  if (ids.length > MAX_NEGOZI || ids.some((id) => !UUID.test(id))) {
    return rispondi({ possibile: false, perche: 'Richiesta non valida.' }, 400);
  }
  const chiesti = [...ids].sort().join(',');
  const rl = await rateLimitAsync({ key: `consegna-veloce:${ip}:${chiesti}`, ...FRENO });
  if (!rl.allowed) return frenato(rl.retryAfterSec);
  try {
    const admin = getAdminSupabase();
    let negozi: Array<{ nome: string; orari: unknown }> | null = [];
    if (ids.length > 0) {
      const { data, error } = await admin
        .from('profiles')
        .select('id, store_name, store_hours')
        .eq('role', 'seller')
        .eq('is_approved', true)
        .in('id', ids);
      if (error || !data) {
        logger.error('consegna veloce: orari dei negozi non letti', { error: error?.message, chiesti: ids.length });
        negozi = null;
      } else if (data.length !== ids.length) {
        // Un negozio del carrello non è più fra quelli approvati: è un «no» col suo motivo, non un guasto.
        return rispondi({ possibile: false, perche: 'Un negozio del carrello non accetta ordini in questo momento: la consegna veloce non si può. Scegli una fascia oraria.' });
      } else {
        negozi = data.map((p) => ({ nome: p.store_name ?? 'Il negozio', orari: p.store_hours }));
      }
    }
    const fattoriniOnline = await contaFattoriniOnline(admin);
    if (fattoriniOnline === null) logger.error('consegna veloce: fattorini online non letti');
    // 5/11/2026 — Se una lettura è caduta la risposta non è «no», è «non so»: 503, così la vetrina
    // e il carrello (che leggono solo le risposte riuscite) non scrivono «consegna domani» su un guasto.
    if (negozi === null || fattoriniOnline === null) return rispondi(NON_RIESCO, 503);
    return rispondi(veloceSiPuo({ adesso: romeNow(), negozi, fattoriniOnline }));
  } catch (e) {
    logger.error('consegna veloce: verifica non riuscita', { error: e instanceof Error ? e.message : String(e) });
    return rispondi(NON_RIESCO, 503);
  }
}

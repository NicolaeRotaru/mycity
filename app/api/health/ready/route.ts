import { NextResponse, type NextRequest } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { segretiCombaciano, gettoneBearer } from '@/lib/api/segreti';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * «È pronto a servire?» — la domanda che include il database.
 *
 * 22/8/2026 — PERCHÉ QUESTA ROTTA È SEPARATA DA /api/health.
 *
 * Quella la interroga l'hosting per decidere se ammazzare il processo. Se ci si
 * mette dentro il database, un database lento fa riavviare istanze sane: si
 * perdono le richieste in corso, il processo riparte, ritrova lo stesso
 * database lento, riparte di nuovo. Un rallentamento diventa un blackout, per
 * mano nostra.
 *
 * Qui invece ci può stare, perché questa rotta la guarda un monitor esterno:
 * avvisa una persona, non riavvia niente. È la stessa distinzione che fanno i
 * sistemi di orchestrazione fra «vivo» e «pronto», e serve esattamente a questo.
 *
 * 27/8/2026 (R186) — ERA RIMASTA INDIETRO RISPETTO AL SUO GEMELLO. Su
 * /api/health le due difese sono state messe e spiegate; qui no. Chiunque
 * poteva leggere il messaggio d'errore grezzo di Postgres — che è una mappa di
 * dov'è scoperto il sito — e far girare una query vera sul database di
 * produzione a raffica da un indirizzo solo, consumando connessioni proprio
 * quando il database è già in difficoltà: è la rotta che si interroga quando
 * le cose vanno male. Adesso qui ci sono le stesse due difese del gemello.
 */
const TETTO_MS = 3000;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Come sul gemello: le sonde interne non mandano `x-forwarded-for` e non
  // devono finire tutte nello stesso contatore, la soglia è larga abbastanza
  // che nessun monitor onesto la tocchi, e sopra soglia si risponde 200 con un
  // corpo minimo — l'abuso non costa una query al database, ma non produce
  // nemmeno un falso allarme «sito caduto».
  if (req.headers.get('x-forwarded-for')) {
    const freno = await rateLimitAsync({ key: `health-ready:${getClientIp(req)}`, max: 600, windowMs: 60_000 });
    if (!freno.allowed) {
      return NextResponse.json(
        { status: 'ready', throttled: true, timestamp: new Date().toISOString() },
        { status: 200, headers: { 'cache-control': 'no-store' } },
      );
    }
  }

  const t0 = Date.now();
  let dbOk = false;
  let dettaglio: string | undefined;

  try {
    const admin = getAdminSupabase();
    const query = admin.from('categories').select('id').limit(1);
    const esito = await Promise.race([
      query.then(({ error }) => ({ scaduto: false as const, error })),
      new Promise<{ scaduto: true; error: null }>((r) =>
        setTimeout(() => r({ scaduto: true, error: null }), TETTO_MS)),
    ]);
    if (esito.scaduto) dettaglio = `nessuna risposta entro ${TETTO_MS}ms`;
    else if (esito.error) dettaglio = esito.error.message;
    else dbOk = true;
  } catch (e) {
    dettaglio = e instanceof Error ? e.message : 'errore sconosciuto';
  }

  // Il dettaglio lo vede chi ha il segreto dei lavori periodici, non il mondo.
  // Il monitor esterno guarda il codice HTTP, che non cambia: 200 pronto, 503
  // no. Chi vuole sapere PERCHÉ deve dimostrare di essere di casa.
  const segreto = process.env.CRON_SECRET;
  const autorizzato =
    process.env.NODE_ENV !== 'production' ||
    (!!segreto && segretiCombaciano(gettoneBearer(req.headers.get('authorization')), segreto));

  return NextResponse.json(
    {
      status: dbOk ? 'ready' : 'not_ready',
      ...(autorizzato ? { db: { ok: dbOk, latencyMs: Date.now() - t0, error: dettaglio } } : {}),
      timestamp: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}

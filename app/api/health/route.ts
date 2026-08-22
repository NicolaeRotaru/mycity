import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
// Sempre fresh: i monitor esterni devono sapere lo stato reale, no cache.
export const dynamic = 'force-dynamic';

/**
 * Controllo di salute, per i monitor esterni.
 *
 * Tre difetti riparati qui, trovati dalla radiografia del 18/8:
 *
 * ① (021, 238) La risposta pubblica diceva a chiunque QUALI segreti mancano —
 *    `checks.env.error` era l'elenco dei nomi — e riportava il messaggio grezzo
 *    del database. È una mappa gratuita di dove il sito è scoperto. Ora fuori
 *    dallo sviluppo la risposta pubblica è {status, timestamp}; il dettaglio
 *    resta, ma dietro il segreto dei lavori periodici.
 *
 * ② (176, 234) Un guasto NON fatale rispondeva 503. Nasceva contro Render, dove
 *    503 su questa rotta voleva dire «istanza morta, riavviala»: bastava che
 *    mancasse la chiave della posta — con cui il sito vende benissimo — per far
 *    togliere dal traffico un'istanza sana.
 *    Su Vercel nessuno spegne niente in base a questa rotta: non ci sono istanze
 *    da riavviare. La regola però resta giusta lo stesso, per un altro motivo:
 *    è il monitor esterno che sveglia una persona alle tre di notte, e va
 *    svegliata solo se il sito non serve una pagina. Fatale è solo questo — il
 *    database e le variabili di Supabase. Il resto è «degradato», e degradato
 *    risponde 200: il monitor lo vede scritto nel corpo e non chiama nessuno.
 *
 * ③ (021) Nessun freno: la rotta interroga il database a ogni chiamata. Sessanta
 *    al minuto per indirizzo bastano a qualunque monitor onesto.
 *    ⚠️ Il freno qui è quello in memoria, e su Vercel la memoria non è condivisa
 *    fra le chiamate: vale dentro una singola istanza tiepida, non su tutte.
 *    Per questa rotta basta — non c'è niente da rubare — ma non prendere questo
 *    punto come prova che il freno del sito regga: quello vero passa da Upstash
 *    (vedi lib/rate-limit.ts).
 */

// Senza queste il sito non risponde: sono le uniche che valgono un 503.
const ENV_VITALI = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_APP_URL',
];

// Senza queste manca un pezzo (incassare, spedire posta, far girare i cron) ma
// il sito sta in piedi: si segnala, non si spegne.
//
// UPSTASH_REDIS_REST_URL è entrato in questa lista con il passaggio a Vercel.
// Su Render il sito era UNA macchina accesa, e il freno anti-abuso in memoria
// bastava: il contatore lo vedevano tutte le richieste. Su Vercel ogni richiesta
// può finire su una copia diversa, ognuna col suo contatore che parte da zero —
// dieci tentativi di accesso a testa diventano dieci per ogni copia. Senza
// Upstash il freno non è rotto, è molto più largo di quanto dica il numero
// scritto nel codice. Va visto, quindi va chiesto qui.
const ENV_IMPORTANTI = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'CRON_SECRET',
  'UPSTASH_REDIS_REST_URL',
];

export async function GET(request: Request) {
  const startedAt = Date.now();
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  const freno = rateLimit({ key: `health:${getClientIp(request)}`, max: 60, windowMs: 60_000 });
  if (!freno.allowed) {
    return NextResponse.json(
      { status: 'rate_limited', timestamp: new Date().toISOString() },
      { status: 429, headers: { 'Retry-After': String(freno.retryAfterSec ?? 60), 'cache-control': 'no-store' } },
    );
  }

  // Check 1: Supabase DB raggiungibile, con un tetto di tempo.
  const TETTO_MS = 3000;
  try {
    const admin = getAdminSupabase();
    const t0 = Date.now();
    const query = admin.from('categories').select('id').limit(1);
    const esito = await Promise.race([
      query.then(({ error }) => ({ scaduto: false as const, error })),
      new Promise<{ scaduto: true; error: null }>((r) =>
        setTimeout(() => r({ scaduto: true, error: null }), TETTO_MS)),
    ]);
    checks.db = esito.scaduto
      ? { ok: false, latencyMs: TETTO_MS, error: `nessuna risposta entro ${TETTO_MS}ms` }
      : { ok: !esito.error, latencyMs: Date.now() - t0, error: esito.error?.message };
  } catch (e) {
    checks.db = { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }

  const mancantiVitali = ENV_VITALI.filter((k) => !process.env[k]);
  const mancantiImportanti = ENV_IMPORTANTI.filter((k) => !process.env[k]);
  checks.env = { ok: mancantiVitali.length === 0, error: mancantiVitali.join(',') || undefined };
  checks.envOpzionali = { ok: mancantiImportanti.length === 0, error: mancantiImportanti.join(',') || undefined };

  const fatale = !checks.db.ok || !checks.env.ok;
  const degradato = !fatale && !checks.envOpzionali.ok;
  const status = fatale ? 'unhealthy' : degradato ? 'degraded' : 'ok';
  const httpStatus = fatale ? 503 : 200;

  // Il dettaglio lo vede chi ha il segreto dei lavori periodici, non il mondo.
  const segreto = process.env.CRON_SECRET;
  const autorizzato =
    process.env.NODE_ENV !== 'production' ||
    (!!segreto && request.headers.get('authorization') === `Bearer ${segreto}`);

  const corpo = autorizzato
    ? {
        status,
        timestamp: new Date().toISOString(),
        // Su Vercel questo NON è «da quanto il sito è su»: è l'età della singola
        // copia che ha risposto, spesso pochi secondi. Si tiene perché in locale
        // dice ancora la verità, ma non è un dato su cui ragionare in produzione.
        uptimeSec: process.uptime?.() ?? null,
        latencyMs: Date.now() - startedAt,
        checks,
      }
    : { status, timestamp: new Date().toISOString() };

  return NextResponse.json(corpo, { status: httpStatus, headers: { 'cache-control': 'no-store' } });
}

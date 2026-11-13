import { MODELS, estimateCostEur } from '@/lib/ai/client';
import { registraSpesaAi } from '@/lib/ai/run';
import { NextResponse } from 'next/server';
import { withSellerAuth } from '@/lib/api/middleware';
import { rateLimitAsync } from '@/lib/rate-limit';
import { ApiErrors } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { INVIO_SENZA_RISPOSTA, pollBatch, streamBatchResults } from '@/lib/ai/batch';
import { parseCatalogBatchEntry, stimaCostoLottoEur, type CatalogJobResult, type CatalogOperation } from '@/lib/ai/catalogBatch';

/**
 * Stato di un job AI massivo. Se il batch è terminato, ne recupera i risultati
 * una volta sola, li parsa e li salva sul job (status 'ready'). Il venditore
 * legge solo i propri job (verifica seller_id). Best-effort sul polling: se
 * Anthropic non risponde, il job resta 'processing' e si riprova.
 */

export const runtime = 'nodejs';

type JobRow = {
  id: string;
  seller_id: string;
  operation: CatalogOperation;
  status: string;
  batch_id: string | null;
  target_lang: string | null;
  total: number;
  results: CatalogJobResult[] | null;
  created_at?: string | null;
  error?: string | null;
};

export const GET = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  // 🟡-17: rate-limit sul polling (ogni chiamata fa poll Anthropic + scritture DB).
  const rl = await rateLimitAsync({ key: `ai-catalog-batch-status:${user.id}`, max: 60, windowMs: 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  const jobId = new URL(req.url).searchParams.get('jobId') ?? '';
  const admin = getAdminSupabase();

  // 12/11/2026 (R04-013) — SENZA jobId: L'ULTIMO LAVORO ANCORA APERTO.
  // L'id del lavoro stava solo nel browser che l'aveva avviato: da un altro
  // telefono, in navigazione privata o con la memoria pulita, il lavoro pagato
  // spariva dalla vista. Adesso la pagina, all'apertura, chiede al server.
  if (!jobId) {
    const { data: aperti } = await admin
      .from('catalog_ai_jobs')
      .select(COLONNE)
      .eq('seller_id', user.id)
      .in('status', ['submitting', 'processing', 'ready'])
      .order('created_at', { ascending: false })
      .limit(1);
    const ultimo = ((aperti ?? []) as JobRow[])[0];
    if (!ultimo) return NextResponse.json(null);
    return rispondiPerLavoro(admin, ultimo, user.id);
  }

  const { data } = await admin
    .from('catalog_ai_jobs')
    .select(COLONNE)
    .eq('id', jobId)
    .single();

  const job = data as JobRow | null;
  if (!job) return ApiErrors.notFound('Job non trovato.');
  if (job.seller_id !== user.id) return ApiErrors.forbidden('Non è un tuo job.');
  return rispondiPerLavoro(admin, job, user.id);
});

/**
 * 12/11/2026 (R04-005) — Un lavoro «in invio» da troppo tempo, senza lotto
 * agganciato, non tornera' mai «in corso» da solo: restava cosi' per sempre e
 * la pagina non mostrava ne' rotella ne' pulsante. Oltre questa soglia lo si
 * chiude come fallito, con il motivo, e il negoziante puo' ripartire.
 */
const INVIO_SCADUTO_MS = 15 * 60_000;
/** Un invio senza risposta (forse partito) resta aperto quanto dura al massimo un lotto. */
const INVIO_INCERTO_SCADUTO_MS = 24 * 60 * 60_000;

const COLONNE = 'id, seller_id, operation, status, batch_id, target_lang, total, results, created_at, error';

async function rispondiPerLavoro(
  admin: ReturnType<typeof getAdminSupabase>,
  job: JobRow,
  sellerId: string,
): Promise<NextResponse> {
  if (job.status === 'submitting' && !job.batch_id) {
    const nato = job.created_at ? Date.parse(job.created_at) : NaN;
    // R04-014 (revisione) — Un invio rimasto SENZA RISPOSTA puo' essere partito:
    // chiuderlo dopo 15 minuti riapriva la porta a un secondo lotto pagato.
    // Quello resta aperto quanto puo' durare un lotto (24 ore); poi si chiude
    // dicendo di controllare prima di ripartire.
    const incerto = job.error === INVIO_SENZA_RISPOSTA;
    const scadenza = incerto ? INVIO_INCERTO_SCADUTO_MS : INVIO_SCADUTO_MS;
    if (Number.isFinite(nato) && Date.now() - nato > scadenza) {
      const motivo = incerto
        ? 'invio senza risposta da 24 ore: il lotto potrebbe essere partito ed essere stato pagato; chiedi all\'assistenza prima di avviarne un altro'
        : job.error
          ? `${job.error} — chiuso dopo ${INVIO_SCADUTO_MS / 60_000} minuti senza lotto agganciato`
          : `invio non confermato: nessun lotto agganciato dopo ${INVIO_SCADUTO_MS / 60_000} minuti`;
      await admin
        .from('catalog_ai_jobs')
        .update({ status: 'failed', error: motivo, updated_at: new Date().toISOString() })
        .eq('id', job.id)
        .eq('seller_id', sellerId)
        .eq('status', 'submitting');
      logger.error('catalog-batch status: lavoro in invio scaduto, chiuso come fallito', { jobId: job.id });
      return NextResponse.json(serialize({ ...job, status: 'failed', error: motivo }));
    }
    return NextResponse.json(serialize(job));
  }

  // Già pronto/applicato/fallito: ritorna lo stato salvato. Un lavoro «in
  // invio» che ha gia' il lotto agganciato si interroga come uno «in corso».
  if ((job.status !== 'processing' && job.status !== 'submitting') || !job.batch_id) {
    return NextResponse.json(serialize(job));
  }
  const user = { id: sellerId };

  // Polling del batch.
  let ended = false;
  try {
    const handle = await pollBatch(job.batch_id);
    ended = handle.processingStatus === 'ended';
  } catch {
    // Anthropic non raggiungibile ora: resta processing, si riprova — ma non
    // per sempre (vedi chiudiSeScaduto).
    return chiudiSeScaduto(admin, job, sellerId);
  }

  if (!ended) return chiudiSeScaduto(admin, job, sellerId);

  // Terminato: recupera e parsa i risultati una volta sola.
  try {
    const results: CatalogJobResult[] = [];
    // 22/8/2026 — LA SPESA DEL LOTTO NON VENIVA REGISTRATA DA NESSUNA PARTE.
    // Il tetto giornaliero contava solo le chiamate singole: il lotto — che e'
    // il canale che spende di piu' in un colpo solo — restava fuori dal conto,
    // quindi il tetto non si muoveva mentre i soldi uscivano. Qui i token
    // tornati indietro diventano euro e finiscono nello stesso contatore.
    let tokenIn = 0;
    let tokenOut = 0;
    for await (const entry of streamBatchResults(job.batch_id)) {
      tokenIn += entry.tokenIn ?? 0;
      tokenOut += entry.tokenOut ?? 0;
      results.push(parseCatalogBatchEntry(job.operation, entry));
    }
    if (tokenIn > 0 || tokenOut > 0) {
      /**
       * 27/8/2026 (R143 · R155) — QUI SI CONTAVA TUTTO, E A TARIFFA PIENA.
       *
       * Alla partenza il lotto impegna gia' una stima (start/route.ts): se qui
       * si registrasse di nuovo il costo intero, la stessa spesa finirebbe nel
       * conto due volte. Si aggiunge solo la DIFFERENZA fra quanto e' costato
       * davvero e quanto era gia' stato impegnato — la stima si ricava dagli
       * stessi due dati che l'hanno prodotta, l'operazione e il numero di
       * prodotti, quindi non serve conservarla.
       *
       * E si conta a meta' tariffa, perche' cosi' si paga il lotto: prima il
       * numero registrato era circa il doppio del vero.
       */
      const costo = estimateCostEur(
        MODELS.fast,
        { inputTokens: tokenIn, outputTokens: tokenOut, cacheWriteTokens: 0, cacheReadTokens: 0 },
        { batch: true },
      );
      const giaImpegnato = stimaCostoLottoEur(job.operation, job.total);
      const daAggiungere = Math.max(0, costo - giaImpegnato);
      if (daAggiungere > 0) await registraSpesaAi(daAggiungere);
      logger.info('[ai] spesa del lotto registrata', {
        jobId: job.id, tokenIn, tokenOut,
        costoEur: costo.toFixed(4),
        giaImpegnatoEur: giaImpegnato.toFixed(4),
        aggiuntoEur: daAggiungere.toFixed(4),
      });
    }
    const { data: updated } = await admin
      .from('catalog_ai_jobs')
      .update({ status: 'ready', results, updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('seller_id', user.id)
      .select('id, seller_id, operation, status, batch_id, target_lang, total, results')
      .single();
    return NextResponse.json(serialize((updated as JobRow) ?? { ...job, status: 'ready', results }));
  } catch {
    logger.error('catalog-batch status: fetch results failed', { jobId: job.id });
    return NextResponse.json(serialize(job));
  }
}

/**
 * 12/11/2026 (R04-025, revisione K02) — UN LAVORO «IN CORSO» CHE NON FINISCE MAI.
 *
 * Con un lavoro aperto non se ne avvia un altro (R04-025): ma un lavoro
 * «processing» che non si chiudeva piu' (lotto sparito, id sbagliato, fornitore
 * che non risponde) teneva chiuso «migliora tutto il catalogo» per sempre. Un
 * lotto dura al massimo 24 ore: oltre le 25 si chiude come fallito, col motivo.
 */
const LOTTO_SCADUTO_MS = 25 * 60 * 60_000;

async function chiudiSeScaduto(
  admin: ReturnType<typeof getAdminSupabase>,
  job: JobRow,
  sellerId: string,
): Promise<NextResponse> {
  const nato = job.created_at ? Date.parse(job.created_at) : NaN;
  if (!(Number.isFinite(nato) && Date.now() - nato > LOTTO_SCADUTO_MS)) return NextResponse.json(serialize(job));
  const motivo = 'il lotto non e\' finito entro 24 ore: chiuso. Se era partito, i risultati si recuperano con l\'assistenza.';
  await admin
    .from('catalog_ai_jobs')
    .update({ status: 'failed', error: motivo, updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('seller_id', sellerId)
    .eq('status', job.status);
  logger.error('catalog-batch status: lotto oltre le 24 ore, chiuso come fallito', { jobId: job.id, batchId: job.batch_id });
  return NextResponse.json(serialize({ ...job, status: 'failed', error: motivo }));
}

function serialize(job: JobRow) {
  const results = Array.isArray(job.results) ? job.results : [];
  const changed = results.filter((r) => (r.patch && Object.keys(r.patch).length > 0) || r.flagged).length;
  return {
    id: job.id,
    operation: job.operation,
    status: job.status,
    total: job.total,
    targetLang: job.target_lang,
    results,
    counts: { total: results.length, withChanges: changed },
    error: job.error ?? null,
  };
}

import { NextResponse } from 'next/server';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { resolveAiPatch, type CategoryRow } from '@/lib/products/aiPatch';
import { PRODUCT_SNAPSHOT_COLS, type ProductRow } from '@/lib/products/aiSnapshot';
import type { CatalogJobResult, CatalogOperation } from '@/lib/ai/catalogBatch';
import { senzaCampiEconomici } from '@/lib/ai/catalogBatch';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { classifyProductPolicy } from '@/lib/ai/moderation';

/**
 * Applica i risultati di un job AI massivo, dopo che il venditore li ha rivisti.
 * Per le operazioni con patch (improve/redescribe/translate) risolve e scrive il
 * patch su ogni prodotto selezionato; per "moderate" mette in bozza i prodotti
 * segnalati. Scrittura sempre vincolata a seller_id = utente. Separato da
 * /status di proposito: lo /status PROPONE, qui si SCRIVE.
 */

export const runtime = 'nodejs';

type Body = { jobId?: string; productIds?: string[] };

type JobRow = {
  id: string;
  seller_id: string;
  operation: CatalogOperation;
  status: string;
  results: CatalogJobResult[] | null;
};

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  const rl = await rateLimitAsync({ key: `ai-catalog-batch-apply:${user.id}`, max: 20, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: Body;
  try {
    body = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    // (R153) Troppo grande e malformato non sono la stessa cosa: il perche' e'
    // scritto per esteso in app/api/ai/catalog-chat/route.ts.
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('JSON non valido');
  }
  const jobId = typeof body.jobId === 'string' ? body.jobId : '';
  if (!jobId) return ApiErrors.invalidRequest('Job mancante.');
  const onlyIds = Array.isArray(body.productIds)
    ? new Set(body.productIds.filter((s): s is string => typeof s === 'string'))
    : null;

  const admin = getAdminSupabase();
  const { data } = await admin
    .from('catalog_ai_jobs')
    .select('id, seller_id, operation, status, results')
    .eq('id', jobId)
    .single();

  const job = data as JobRow | null;
  if (!job) return ApiErrors.notFound('Job non trovato.');
  if (job.seller_id !== user.id) return ApiErrors.forbidden('Non è un tuo job.');
  if (job.status !== 'ready') return ApiErrors.invalidRequest('Il job non è pronto da applicare.');

  const results = (Array.isArray(job.results) ? job.results : []).filter(
    (r) => r.product_id && (!onlyIds || onlyIds.has(r.product_id)),
  );
  if (results.length === 0) return ApiErrors.invalidRequest('Nessun risultato da applicare.');

  const { data: categoriesData } = await admin
    .from('categories')
    .select('id, name, slug, parent_id')
    .order('name');
  const categories = (categoriesData ?? []) as CategoryRow[];

  let applied = 0;

  if (job.operation === 'moderate') {
    // "Applica" = metti in bozza i prodotti segnalati (de-pubblica).
    const flaggedIds = results.filter((r) => r.flagged).map((r) => r.product_id);
    if (flaggedIds.length > 0) {
      const { data: updated } = await admin
        .from('products')
        .update({ status: 'draft' })
        .eq('seller_id', user.id)
        .in('id', flaggedIds)
        .select('id');
      applied = (updated ?? []).length;
      // #196 — Anche la de-pubblicazione automatica lascia traccia: e' la
      // modifica piu' brusca che l'AI possa fare a un catalogo.
      for (const riga of (updated ?? []) as Array<{ id: string }>) {
        void writeAudit({
          actorId: user.id,
          action: 'product.hide',
          targetTable: 'products',
          targetId: riga.id,
          metadata: { origine: 'ai-batch:moderate', dopo: { status: 'draft' } },
        });
      }
    }
  } else {
    // Patch: carica i prodotti correnti del venditore e applica uno per uno.
    const ids = results.filter((r) => r.patch && Object.keys(r.patch).length > 0).map((r) => r.product_id);
    if (ids.length > 0) {
      const { data: rows } = await admin
        .from('products')
        .select(`${PRODUCT_SNAPSHOT_COLS}, seller_id`)
        .eq('seller_id', user.id)
        .in('id', ids);
      const current = new Map((rows ?? []).map((r) => [(r as { id: string }).id, r as unknown as ProductRow]));

      // 22/8/2026 — IL LOTTO SCRIVEVA NOME E DESCRIZIONE SENZA IL FILTRO.
      //
      // La rotta gemella che applica una modifica sola lo dice con parole sue:
      // «un filtro che si puo' aggirare cambiando strada non e' un filtro». Il
      // filtro dei prodotti vietati stava li' e non qui, dove il lavoro
      // massivo riscrive nome e descrizione di decine di prodotti in un colpo.
      //
      // Adesso c'e' anche qui, e si controlla solo chi tocca nome o
      // descrizione: sul prezzo o sulla scorta il filtro non ha niente da
      // dire. I controlli partono tutti insieme, non in fila, perche' un lotto
      // e' fatto di decine di prodotti e ognuno e' un'andata e ritorno verso
      // il modello.
      //
      // Detto onestamente: questa NON e' copertura piena. Il venditore
      // modifica i propri prodotti anche dal browser, scrivendo dritto sul
      // database, e quella strada non passa da nessuna rotta e quindi da
      // nessun filtro. Chiudere qui toglie una scorciatoia; la porta grande
      // resta aperta per come e' fatto il progetto, ed e' una decisione da
      // prendere a monte, non una riga da aggiungere qui.
      const daFiltrare = results.filter((r) => {
        if (!r.patch || Object.keys(r.patch).length === 0) return false;
        if (!current.has(r.product_id)) return false;
        const patch = r.patch as Record<string, unknown>;
        return typeof patch.name === 'string' || typeof patch.description === 'string';
      });
      const verdetti = await Promise.allSettled(
        daFiltrare.map((r) => {
          const row = current.get(r.product_id) as ProductRow;
          const patch = r.patch as Record<string, unknown>;
          return classifyProductPolicy(
            {
              name: typeof patch.name === 'string' ? patch.name : (row.name ?? ''),
              description:
                typeof patch.description === 'string'
                  ? patch.description
                  : (row.description ?? ''),
            },
            'catalog-batch-apply-policy',
          );
        }),
      );
      // Chi non passa — o su cui il filtro e' caduto — non si scrive: nel
      // dubbio si nega, come fa il filtro stesso quando risponde.
      const bloccati = new Set<string>();
      daFiltrare.forEach((r, i) => {
        const esito = verdetti[i];
        if (esito.status === 'rejected' || !esito.value.allowed) bloccati.add(r.product_id);
      });
      if (bloccati.size > 0) {
        logger.warn('catalog-batch apply: modifiche scartate dal filtro', {
          sellerId: user.id,
          scartati: bloccati.size,
          controllati: daFiltrare.length,
        });
      }

      for (const r of results) {
        if (bloccati.has(r.product_id)) continue;
        if (!r.patch || Object.keys(r.patch).length === 0) continue;
        const row = current.get(r.product_id);
        if (!row) continue;
        const { update } = resolveAiPatch({
          // Seconda guardia, e non e' un doppione: la prima sta dove il
          // risultato del lotto viene letto, questa dove viene SCRITTO. Se
          // domani un patch arriva da un'altra strada — un ritentativo, un
          // formato nuovo — il prezzo non passa lo stesso.
          patch: senzaCampiEconomici(r.patch),
          // Il prezzo attuale serve al freno del 30%: senza, quel controllo
          // dentro `resolveAiPatch` confronta con zero e non scatta mai. Qui i
          // campi economici sono gia' tolti da `senzaCampiEconomici`, ma la
          // difesa si tiene comunque: la prossima strada che arriva potrebbe
          // non toglierli.
          current: { attributes: row.attributes ?? null, category_id: row.category_id, has_variants: row.has_variants, price: row.price },
          categories,
        });
        if (Object.keys(update).length === 0) continue;
        const { error } = await admin
          .from('products')
          .update(update)
          .eq('id', r.product_id)
          .eq('seller_id', user.id);
        if (!error) {
          applied += 1;
          // #196 — Il lavoro massivo tocca decine di prodotti in un colpo: senza
          // traccia, se qualcosa esce storto non si sa neanche da dove partire.
          const prima: Record<string, unknown> = {};
          for (const campo of Object.keys(update)) prima[campo] = (row as unknown as Record<string, unknown>)[campo];
          void writeAudit({
            actorId: user.id,
            action: 'product.update',
            targetTable: 'products',
            targetId: r.product_id,
            metadata: { origine: `ai-batch:${job.operation}`, campi: Object.keys(update), prima, dopo: update },
          });
        }
      }
    }
  }

  await admin
    .from('catalog_ai_jobs')
    .update({ status: 'applied', updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('seller_id', user.id);

  logger.info('catalog-batch applied', { jobId: job.id, operation: job.operation, applied });
  return NextResponse.json({ ok: true, applied });
});

import { AiConfigError } from '@/lib/ai/client';
import { AiCallError, mapAiError } from '@/lib/ai/run';
import { NextResponse } from 'next/server';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { writeAudit } from '@/lib/audit';
import { resolveAiPatch, type AiProductPatch, type CategoryRow } from '@/lib/products/aiPatch';
import { PRODUCT_SNAPSHOT_COLS, type ProductRow } from '@/lib/products/aiSnapshot';
import { classifyProductPolicy } from '@/lib/ai/moderation';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

/**
 * Applica in un colpo solo le modifiche che il Catalog Copilot ha proposto.
 *
 * 27/8/2026 (R157) — LA FUNZIONE PROMETTEVA IL MASSIVO E CONSEGNAVA IL SERIALE.
 *
 * Il copilot prepara fino a duecento modifiche in una volta. La rotta che le
 * applicava ne accettava sessanta all'ora, una per chiamata, e ogni chiamata
 * rileggeva il prodotto, rileggeva TUTTE le categorie e — se la modifica
 * toccava nome o descrizione — faceva partire una chiamata al modello per il
 * controllo di conformita'. Il pannello le mandava in fila, una dopo l'altra:
 * «abbassa del 10% l'elettronica» su un catalogo grande diventava un lavoro in
 * tre riprese a un'ora di distanza, col venditore che guarda una barra avanzare
 * una chiamata alla volta.
 *
 * Qui e' un solo POST: una lettura dei prodotti, una lettura delle categorie, i
 * controlli di conformita' in parallelo (come fa gia' l'applica del lavoro
 * massivo), e le scritture in fila — che sono l'unica cosa che deve restare
 * per prodotto.
 *
 * Cosa NON cambia, e non deve cambiare: ogni scrittura resta vincolata a
 * seller_id = utente, ogni patch passa da `resolveAiPatch` (che tiene il freno
 * sul prezzo), e una modifica che tocca nome o descrizione passa dal filtro —
 * se il filtro nega o cade, quel prodotto non si scrive.
 */

export const runtime = 'nodejs';

/** Lo stesso tetto che il copilot usa per proporre (copilot/route.ts). */
const MAX_CHANGES = 200;

type Change = { productId?: string; patch?: AiProductPatch };
type BulkBody = { changes?: Change[] };
type Esito = { productId: string; ok: boolean; motivo?: string };

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  // Una chiamata porta fino a duecento modifiche: dieci all'ora sono duemila
  // modifiche, cioe' molto piu' di quante il copilot possa proporne in un'ora.
  const rl = await rateLimitAsync({ key: `ai-catalog-apply-bulk:${user.id}`, max: 10, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: BulkBody;
  try {
    body = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('JSON non valido');
  }

  const changes = (Array.isArray(body.changes) ? body.changes : [])
    .filter((c): c is { productId: string; patch: AiProductPatch } =>
      !!c && typeof c.productId === 'string' && !!c.productId &&
      !!c.patch && typeof c.patch === 'object' && Object.keys(c.patch).length > 0)
    .slice(0, MAX_CHANGES);

  if (changes.length === 0) return ApiErrors.invalidRequest('Nessuna modifica da applicare.');

  const admin = getAdminSupabase();
  const ids = Array.from(new Set(changes.map((c) => c.productId)));

  // Una lettura sola per tutti i prodotti, e una per le categorie: prima erano
  // due letture PER MODIFICA.
  const [{ data: rowsData }, { data: categoriesData }] = await Promise.all([
    admin
      .from('products')
      .select(`${PRODUCT_SNAPSHOT_COLS}, seller_id`)
      .eq('seller_id', user.id)
      .in('id', ids),
    admin.from('categories').select('id, name, slug, parent_id').order('name'),
  ]);

  const categories = (categoriesData ?? []) as CategoryRow[];
  const miei = new Map<string, ProductRow>();
  for (const r of (rowsData ?? []) as (ProductRow & { seller_id?: string })[]) {
    if (r.seller_id === user.id) miei.set(r.id, r as ProductRow);
  }

  // Primo giro: risolvi i patch. Niente rete, solo validazione.
  const risolte: { id: string; row: ProductRow; update: Record<string, unknown> }[] = [];
  const esiti: Esito[] = [];
  for (const c of changes) {
    const row = miei.get(c.productId);
    if (!row) {
      esiti.push({ productId: c.productId, ok: false, motivo: 'non e un tuo prodotto' });
      continue;
    }
    const { update } = resolveAiPatch({
      patch: c.patch,
      current: {
        attributes: row.attributes ?? null,
        category_id: row.category_id,
        has_variants: row.has_variants,
        // Senza il prezzo attuale il freno del 30% dentro `resolveAiPatch`
        // confronta con zero e non scatta mai (vedi catalog-apply).
        price: row.price,
      },
      categories,
    });
    if (Object.keys(update).length === 0) {
      esiti.push({ productId: c.productId, ok: false, motivo: 'nessuna modifica valida' });
      continue;
    }
    risolte.push({ id: c.productId, row, update });
  }

  // Secondo giro: il filtro di conformita', solo su chi tocca nome o
  // descrizione, e tutti insieme invece che uno dopo l'altro.
  const daFiltrare = risolte.filter(
    (r) => typeof r.update.name === 'string' || typeof r.update.description === 'string',
  );
  let erroreDelFiltro: unknown = null;
  const bloccati = new Map<string, string>();
  if (daFiltrare.length > 0) {
    const verdetti = await Promise.allSettled(
      daFiltrare.map((r) =>
        classifyProductPolicy(
          {
            name: typeof r.update.name === 'string' ? r.update.name : (r.row.name ?? ''),
            description:
              typeof r.update.description === 'string' ? r.update.description : (r.row.description ?? ''),
          },
          'catalog-apply-bulk-policy',
        ),
      ),
    );
    daFiltrare.forEach((r, i) => {
      const esito = verdetti[i];
      // Nel dubbio si nega, come fa il filtro stesso quando non sa rispondere.
      if (esito.status === 'rejected') {
        erroreDelFiltro = erroreDelFiltro ?? esito.reason;
        bloccati.set(r.id, 'controllo di conformita non riuscito');
      } else if (!esito.value.allowed) {
        bloccati.set(r.id, esito.value.reason);
      }
    });
  }

  // Se il filtro e' caduto per TUTTI, il guasto e' del servizio, non del
  // contenuto: si risponde come farebbe la generazione, senza scrivere niente.
  if (erroreDelFiltro && bloccati.size === daFiltrare.length && daFiltrare.length === risolte.length) {
    if (erroreDelFiltro instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (erroreDelFiltro instanceof AiCallError) return mapAiError(erroreDelFiltro, 'ai-catalog-apply-bulk-policy');
    return ApiErrors.internal('Errore AI.');
  }

  let applied = 0;
  for (const r of risolte) {
    const motivo = bloccati.get(r.id);
    if (motivo) {
      esiti.push({ productId: r.id, ok: false, motivo });
      continue;
    }
    const { error } = await admin
      .from('products')
      .update(r.update)
      .eq('id', r.id)
      .eq('seller_id', user.id);
    if (error) {
      logger.error('catalog-apply-bulk update failed', { productId: r.id, status: error.code });
      esiti.push({ productId: r.id, ok: false, motivo: 'non sono riuscito a salvare' });
      continue;
    }
    applied += 1;
    esiti.push({ productId: r.id, ok: true });
    const prima: Record<string, unknown> = {};
    for (const campo of Object.keys(r.update)) prima[campo] = (r.row as unknown as Record<string, unknown>)[campo];
    void writeAudit({
      actorId: user.id,
      action: 'product.update',
      targetTable: 'products',
      targetId: r.id,
      metadata: { origine: 'ai-copilot-bulk', campi: Object.keys(r.update), prima, dopo: r.update },
    });
  }

  logger.info('catalog-apply-bulk', { sellerId: user.id, chieste: changes.length, applied });
  return NextResponse.json({ ok: true, applied, total: changes.length, results: esiti });
});

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
import {
  cosaMancaDopoLaModifica,
  erroreDiSalvataggio,
  motivoDaCompletare,
} from '@/lib/products/prontoPerLaVendita';
import { fraseSulleDichiarazioni } from '@/lib/products/avvisoDellaDettatura';

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
/**
 * `nonApplicato`: su una modifica scritta solo in parte, cosa non e' entrato e
 * perche' (le dichiarazioni di un alimento, che il Copilot non scrive mai).
 */
type Esito = { productId: string; ok: boolean; motivo?: string; nonApplicato?: string; rifiutati?: string[] };

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
  const [
    { data: rowsData, error: erroreProdotti },
    { data: categoriesData, error: erroreCategorie },
  ] = await Promise.all([
    admin
      .from('products')
      .select(`${PRODUCT_SNAPSHOT_COLS}, seller_id`)
      .eq('seller_id', user.id)
      .in('id', ids),
    admin.from('categories').select('id, name, slug, parent_id').order('name'),
  ]);

  // S10 (5/11/2026) — Se una delle due letture cade non si scrive niente. Prima
  // le categorie diventavano [] (e il controllo degli obbligatori di un
  // alimento non scattava) e i prodotti risultavano «non tuoi».
  if (erroreProdotti || erroreCategorie) {
    return ApiErrors.unavailable('Non riesco a leggere il catalogo in questo momento. Riprova fra poco: non ho cambiato niente.');
  }

  const categories = (categoriesData ?? []) as CategoryRow[];
  const miei = new Map<string, ProductRow>();
  for (const r of (rowsData ?? []) as (ProductRow & { seller_id?: string })[]) {
    if (r.seller_id === user.id) miei.set(r.id, r as ProductRow);
  }

  // Primo giro: risolvi i patch. Niente rete, solo validazione.
  const risolte: {
    id: string;
    row: ProductRow;
    update: Record<string, unknown>;
    nonApplicato: string | null;
    rifiutati: string[];
  }[] = [];
  const esiti: Esito[] = [];
  // S10 (5/11/2026) — Due voci sullo stesso prodotto si controllavano una per
  // una contro la stessa fotografia, e insieme passavano quello che nessuna
  // delle due avrebbe passato da sola. Una sola modifica per prodotto: vale la
  // prima, le altre si scartano e si dice perche'.
  const giaVisti = new Set<string>();
  for (const c of changes) {
    if (giaVisti.has(c.productId)) {
      esiti.push({ productId: c.productId, ok: false, motivo: 'una sola modifica per prodotto: questa voce in più è stata scartata' });
      continue;
    }
    giaVisti.add(c.productId);
    const row = miei.get(c.productId);
    if (!row) {
      esiti.push({ productId: c.productId, ok: false, motivo: 'non è un tuo prodotto' });
      continue;
    }
    const { update, protetti, rifiutati } = resolveAiPatch({
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
    // R41 — allergeni e ingredienti li scrive il negoziante, non il copilot.
    // Si dice con la frase fissa della dettatura, sia quando la modifica era
    // fatta solo di dichiarazioni (prodotto fermo) sia quando insieme c'era
    // altro: prima, in quel caso, il resto si scriveva e l'esito era «ok» senza
    // una parola, e il Copilot rispondeva «Applicato a 1 prodotti su 1».
    // 1/11/2026 — Anche un prezzo rifiutato dal freno del 30% si dice: prima
    // l'esito era «ok» e il Copilot rispondeva «Applicato», col prezzo vecchio.
    const nonApplicato =
      [fraseSulleDichiarazioni(protetti), ...rifiutati.map((r) => r.motivo)].filter(Boolean).join('; ') || null;
    const campiRifiutati = rifiutati.map((r) => r.campo);
    if (Object.keys(update).length === 0) {
      esiti.push({
        productId: c.productId,
        ok: false,
        motivo: nonApplicato ?? 'nessuna modifica valida',
        ...(campiRifiutati.length > 0 ? { rifiutati: campiRifiutati } : {}),
      });
      continue;
    }
    // R36 — Messo in vendita (o spostato di categoria) dal copilot = stessi
    // controlli del modulo, con la stessa frase della chat.
    const mancanti = cosaMancaDopoLaModifica({ prima: row, update, categories });
    if (mancanti.length > 0) {
      esiti.push({
        productId: c.productId,
        ok: false,
        motivo: motivoDaCompletare(mancanti),
      });
      continue;
    }
    risolte.push({ id: c.productId, row, update, nonApplicato, rifiutati: campiRifiutati });
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
      const esito = erroreDiSalvataggio(error);
      esiti.push({
        productId: r.id,
        ok: false,
        motivo: esito.tipo === 'regola' ? esito.messaggio : 'non sono riuscito a salvare',
      });
      continue;
    }
    applied += 1;
    esiti.push({
      productId: r.id,
      ok: true,
      ...(r.nonApplicato ? { nonApplicato: r.nonApplicato } : {}),
      ...(r.rifiutati.length > 0 ? { rifiutati: r.rifiutati } : {}),
    });
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

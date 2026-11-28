import { NextResponse } from 'next/server';
import { AI_NEGOZI_ACCESA } from '@/lib/funzioni-al-lancio';
import { env } from '@/lib/env';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { chiamataDelCalendarioFerma, rispostaDelFermo } from '@/lib/cron/fermo-dei-lavori';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { AiCallError } from '@/lib/ai/run';
import { TEMPO_TENTATIVO_AI_MS } from '@/lib/ai/client';
import { fetchExternalSnapshot, restituisciRitentoDopoErrore, ritentoDopoErroreConsentito } from '@/lib/products/externalSync';
import { isStale, type ExternalData, type Marketplace } from '@/lib/products/externalSyncShared';
import { detectExternalChange, changeMessage } from '@/lib/products/externalAlert';

/**
 * Cron: alert riprezzo/stock sui prodotti importati.
 *
 * Ricontrolla i prodotti importati da marketplace (external_source_url) il cui
 * snapshot è "stale", ri-recupera prezzo e disponibilità alla fonte e — se sono
 * cambiati in modo notevole — notifica il venditore e aggiorna lo snapshot. Cap
 * per giro (la verifica usa l'AI: costosa) e sempre solo sugli stale, così i giri
 * si distribuiscono nel tempo.
 *
 * Cadenza: ogni ora. Chi la fa partire sta in `vercel.json` → `crons`.
 * A mano si chiama così:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yoursite/api/cron/external-price-alerts
 */

export const runtime = 'nodejs';

const BATCH = 10; // prodotti per giro (la verifica AI costa)

/**
 * 26/11/2026 (R03-003) — IL GIRO RESTA DENTRO LA SUA DURATA. Fino a 10 chiamate in fila da
 * 60 s l'una (TEMPO_TENTATIVO_AI_MS) superavano i 300 s di `vercel.json`: la funzione veniva
 * spenta a meta' giro. Una chiamata nuova parte solo se, anche impiegando tutto il suo tempo,
 * finisce prima di (durata - margine); i prodotti rimasti non si toccano e vanno al giro dopo.
 */
const DURATA_GIRO_MS = 300_000;
const MARGINE_GIRO_MS = 30_000;

type Row = {
  id: string;
  name: string | null;
  seller_id: string | null;
  external_marketplace: Marketplace | null;
  external_data: ExternalData | null;
  external_source_url: string | null;
  external_synced_at: string | null;
  external_sync_status?: string | null;
};

const handler = withCronAuth(async (req): Promise<NextResponse> => {
  // R03-003 — il tempo del giro si conta da qui: avvio e selezione dei candidati fanno parte dei 300 s.
  const inizioGiro = Date.now();
  // 31/10/2026 — Il fermo dei lavori a orario: dopo il segreto, prima di tutto il resto (lib/cron/fermo-dei-lavori.ts).
  if (chiamataDelCalendarioFerma(req)) return rispostaDelFermo();
  // 5/11/2026 — Con l'AI dei negozi spenta al lancio il giro non parte: con la chiave presente
  // ogni prodotto finiva segnato «error» (il client AI lancia a interruttore spento).
  if (!AI_NEGOZI_ACCESA) return NextResponse.json({ ok: true, skipped: 'AI spenta al lancio' });
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');
  // 27/8/2026 (R009) — IL CLIENT AMMINISTRATIVO SI PRENDE DA UN POSTO SOLO.
  // Qui se ne costruiva uno a mano: cinque copie in giro per il progetto, e
  // ognuna e' un posto in piu' da ricordare il giorno in cui la chiave di
  // servizio va ruotata o vanno cambiate le opzioni del client (per esempio per
  // mettere un tetto di tempo). Dimenticarne una vuol dire una rotta che smette
  // di funzionare in silenzio. `getAdminSupabase()` tiene da parte un client
  // solo (#245: ogni client porta la sua coda di connessioni e i suoi timer).
  let supa;
  try {
    supa = getAdminSupabase();
  } catch (e) {
    return ApiErrors.unavailable(e instanceof Error ? e.message : 'service unavailable');
  }

  // Candidati: prodotti importati, dal meno recente. Filtro "stale" in codice.
  // 12/11/2026 (R04-011, revisione K02) — I FALLITI NON OCCUPANO LA TESTA DELLA FILA.
  // Da quando un fallimento non sposta piu' external_synced_at (quella data dice
  // solo «dati arrivati»), i prodotti sempre in errore restavano i piu' vecchi e
  // riempivano ogni giro: i sani non si controllavano piu'. Adesso si prendono
  // prima i prodotti non in errore; i falliti solo nei posti che restano, e solo
  // se il loro freno di sei ore lo consente.
  const colonne = 'id, name, seller_id, external_marketplace, external_data, external_source_url, external_synced_at, external_sync_status';
  const { data: sani, error } = await supa
    .from('products')
    .select(colonne)
    .not('external_source_url', 'is', null)
    .or('external_sync_status.is.null,external_sync_status.neq.error')
    .order('external_synced_at', { ascending: true, nullsFirst: true })
    .limit(BATCH * 3);
  if (error) return ApiErrors.internal(error.message);

  const rows = ((sani ?? []) as Row[]).filter((r) => isStale(r.external_synced_at)).slice(0, BATCH);
  // 27/11/2026 — IL PERMESSO DI RIPROVARE SI CONSUMA SOLO QUANDO IL PRODOTTO SI ELABORA.
  // Prima i falliti consumavano il permesso delle sei ore gia' qui, in selezione: se poi il
  // giro li lasciava fuori (tempo finito, modello mancante) restavano fermi altre sei ore
  // senza essere stati ritentati. Adesso qui sono solo candidati in coda dopo i sani; il
  // permesso si chiede nel giro, subito prima della chiamata.
  const coda: Row[] = [...rows];
  const daFalliti = new Set<string>();
  if (rows.length < BATCH) {
    const { data: falliti } = await supa
      .from('products')
      .select(colonne)
      .not('external_source_url', 'is', null)
      .eq('external_sync_status', 'error')
      .order('external_synced_at', { ascending: true, nullsFirst: true })
      .limit(BATCH * 3);
    for (const r of (falliti ?? []) as Row[]) {
      if (!isStale(r.external_synced_at)) continue;
      coda.push(r);
      daFalliti.add(r.id);
    }
  }

  let checked = 0, alerts = 0, errors = 0;
  let modelloNonTrovato = false;
  let fermoPerSpesa = false;
  let rimasti = 0;
  let presi = 0; // posti del giro usati: i sani, e i falliti che hanno avuto il permesso
  const now = new Date().toISOString();

  for (let i = 0; i < coda.length && presi < BATCH; i++) {
    const r = coda[i];
    // R03-003 — niente chiamata nuova se non c'e' il tempo di finirla.
    if (Date.now() - inizioGiro + TEMPO_TENTATIVO_AI_MS > DURATA_GIRO_MS - MARGINE_GIRO_MS) {
      rimasti = Math.min(coda.length - i, BATCH - presi);
      break;
    }
    if (daFalliti.has(r.id)) {
      if (!(await ritentoDopoErroreConsentito(r.id))) continue;
    }
    presi += 1;
    const prev = r.external_data;
    const query = prev?.source_title || r.name || '';
    if (!query) continue;
    try {
      const extract = await fetchExternalSnapshot(query, r.external_marketplace ?? undefined);
      checked += 1;

      const next = { price: extract.price, availability: extract.external.availability };
      const delta = prev ? detectExternalChange({ price: prev.price, availability: prev.availability }, next) : null;

      // Aggiorna sempre lo snapshot (così il prodotto non resta stale ad ogni giro).
      const newData: ExternalData = { ...extract.external, fetched_at: now };
      await supa
        .from('products')
        .update({ external_data: newData, external_synced_at: now, external_sync_status: 'idle' })
        .eq('id', r.id);

      if (delta && r.seller_id) {
        const { title, body } = changeMessage(r.name ?? 'prodotto', delta);
        await supa.from('notifications').insert({
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        // 5/11/2026 — 'system', non 'promo': è un avviso di servizio sul listino del negozio, e le
        // promozioni partono spente (migrazione 119), quindi sul telefono non arrivava mai.
        category: 'system',
          user_id: r.seller_id,
          title,
          body,
          link: `/seller/products/${r.id}/edit`,
        });
        alerts += 1;
      }
    } catch (err) {
      // 27/11/2026 — Budget AI finito o spesa di oggi non leggibile: vale per tutti e non e'
      // colpa del prodotto. Il giro si ferma qui e nessun prodotto, questo compreso, finisce
      // segnato 'error' (dietro il freno di sei ore anche quando il budget torna).
      if (err instanceof AiCallError && (err.motivo === 'tetto_spesa' || err.motivo === 'spesa_sconosciuta')) {
        fermoPerSpesa = true;
        logger.warn('external-price-alerts: giro fermo per la spesa AI', { motivo: err.motivo, productId: r.id });
        // R02-010 (onda 2) — Il prodotto in errore non e' stato ritentato: il permesso di sei
        // ore preso qui sopra torna suo, se no resterebbe frenato anche col budget tornato.
        if (daFalliti.has(r.id)) await restituisciRitentoDopoErrore(r.id);
        rimasti = Math.min(coda.length - i, BATCH - presi + 1);
        break;
      }
      errors += 1;
      // 17/11/2026 (R03-007) — Un 404 del fornitore AI vuol dire «il modello configurato
      // non c'e' (piu')», non «questo prodotto non si aggiorna»: si dice per quello che e',
      // con l'allarme delle rotte AI (`mapAiError`).
      if (err instanceof AiCallError && err.status === 404) {
        modelloNonTrovato = true;
        logger.error('[ai] il fornitore non trova il modello: controllare AI_MODELLO_SMART', { feature: err.feature, productId: r.id });
        // R03-002 — Il modello manca per tutti: il giro si ferma qui. Nessun prodotto, questo
        // compreso, finisce segnato 'error' (dietro il freno di sei ore) per un guasto non suo.
        // R02-010 (onda 2) — E il permesso di sei ore, se l'aveva preso, gli torna.
        if (daFalliti.has(r.id)) await restituisciRitentoDopoErrore(r.id);
        rimasti = Math.min(coda.length - i - 1, BATCH - presi);
        break;
      } else {
        logger.warn('external-price-alerts: check failed', { productId: r.id });
      }
      // Marca come errore. R04-011 — external_synced_at NON si tocca (non e'
      // arrivato niente): il freno e' ritentoDopoErroreConsentito, qui sopra.
      await supa.from('products').update({ external_sync_status: 'error' }).eq('id', r.id);
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: presi + rimasti,
    checked,
    alerts,
    errors,
    ...(rimasti > 0 ? { rimasti } : {}),
    ...(modelloNonTrovato ? { errore: 'Il fornitore AI non trova il modello: controllare AI_MODELLO_SMART.' } : {}),
    ...(fermoPerSpesa ? { fermo: 'Budget AI finito o spesa di oggi non leggibile: il giro riprende al prossimo.' } : {}),
  });
});

export const POST = handler;
export const GET = handler;

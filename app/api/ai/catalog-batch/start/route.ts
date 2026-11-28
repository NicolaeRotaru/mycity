import { AiCallError, controllaTettoSpesaAi, mapAiError, registraSpesaAi } from '@/lib/ai/run';
import { NextResponse } from 'next/server';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors, apiError } from '@/lib/api/responses';
import { rateLimitAsync } from '@/lib/rate-limit';
import { env } from '@/lib/env';
import { AI_NEGOZI_ACCESA } from '@/lib/funzioni-al-lancio';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { AiConfigError } from '@/lib/ai/client';
import { INVIO_SENZA_RISPOSTA, invioIncerto, submitBatch } from '@/lib/ai/batch';
import {
  buildCatalogBatchRequests,
  isCatalogOperation,
  isSupportedLang,
  operazioneAccesa,
  stimaCostoLottoEur,
  type CatalogOperation,
} from '@/lib/ai/catalogBatch';
import { PRODUCT_SNAPSHOT_COLS, type ProductRow } from '@/lib/products/aiSnapshot';
import type { CategoryRow } from '@/lib/products/aiPatch';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON_CON_FOTO } from '@/lib/api/corpo';

/**
 * Avvia un job AI massivo sul catalogo (Batch API). Costruisce una richiesta per
 * prodotto, invia il batch ad Anthropic e crea la riga di tracciamento. NON
 * applica nulla: i risultati si recuperano via /status e si applicano via
 * /apply (human-in-the-loop). Scrittura vincolata a seller_id = utente.
 */

export const runtime = 'nodejs';

const MAX_PRODUCTS = 200;

/**
 * 17/11/2026 (R03-012) — Quanto si traduce in una richiesta sola: lo stesso tetto
 * della traduzione dal modulo (app/api/ai/translate/route.ts, MAX_TESTO_TRADUCIBILE).
 */
const MAX_TESTO_TRADUCIBILE = 2500;
const testoTroppoLungoPerTradurre = (p: ProductRow) =>
  (typeof p.name === 'string' ? p.name.length : 0) + (typeof p.description === 'string' ? p.description.length : 0) >
  MAX_TESTO_TRADUCIBILE;

/** Un lavoro in questi stati e' ancora aperto: pagato, e non ancora chiuso dal venditore. */
const STATI_APERTI = ['submitting', 'processing', 'ready'];

/**
 * 22/11/2026 (R13-001 · R13-009) — Il segno di fine dell'applicazione. La colonna
 * non la crea ancora nessuna migrazione (entrera' insieme ai tipi rigenerati in
 * lib/database.types.ts e alla scrittura del segno in /apply). Il nome sta in una
 * costante perche' i tipi generati non lo conoscono ancora.
 * 27/11/2026 (R02-004) — Finche' la colonna non c'e' la lettura cade con 42703:
 * prima l'avvio andava avanti e l'attesa non scattava mai. Adesso si rilegge
 * senza la colonna e si aspetta lo stesso, contando i 120 s dall'inizio
 * dell'applicazione.
 */
const COLONNA_FINE_APPLICAZIONE = 'applicazione_finita_il';
/** Quanto dura al massimo un'applicazione: la rotta /apply ha 120 s. */
const APPLICAZIONE_MAX_MS = 120_000;
/** La colonna non c'e' ancora (la 750 non e' applicata): Postgres 42703, PostgREST PGRST204. */
const COLONNA_ASSENTE = new Set(['42703', 'PGRST204']);

type Body = { operation?: string; targetLang?: string };

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  // Spento al lancio (carta #209): nessun lotto parte, nessuna riga, nessuna spesa.
  if (!AI_NEGOZI_ACCESA) return ApiErrors.unavailable('Gli strumenti AI per i negozi non sono ancora attivi.');
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');
  // Job pesante: pochi avvii per ora.
  const rl = await rateLimitAsync({ key: `ai-catalog-batch-start:${user.id}`, max: 5, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: Body;
  try {
    body = await jsonRichiesta(req, TETTO_JSON_CON_FOTO);
  } catch (errore) {
    // (R153) Troppo grande e malformato non sono la stessa cosa: il perche' e'
    // scritto per esteso in app/api/ai/catalog-chat/route.ts.
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('JSON non valido');
  }
  if (!isCatalogOperation(body.operation)) {
    return ApiErrors.invalidRequest('Operazione non valida.');
  }
  // «Traduci» spento: il lotto va fermato qui, prima di mandarlo al modello e di
  // impegnarne la spesa. Prima lo fermava solo /apply, a soldi già spesi.
  if (!operazioneAccesa(body.operation)) {
    return ApiErrors.invalidRequest('La traduzione del catalogo non è attiva.');
  }
  const operation: CatalogOperation = body.operation;
  const targetLang = operation === 'translate' ? body.targetLang : undefined;
  if (operation === 'translate' && !isSupportedLang(targetLang)) {
    return ApiErrors.invalidRequest('Lingua di destinazione non supportata.');
  }

  const admin = getAdminSupabase();

  // 12/11/2026 (R04-025 · R04-013) — UN SECONDO LAVORO PAGAVA DI NUOVO.
  // Con un lavoro ancora aperto (in invio, in corso o pronto da rivedere) un
  // secondo avvio mandava un altro lotto e impegnava di nuovo la spesa, mentre
  // il primo restava li', pagato. Adesso si rifiuta e si dice quale e' aperto:
  // la pagina lo riprende invece di farne partire un altro.
  const { data: aperti, error: errAperti } = await admin
    .from('catalog_ai_jobs')
    .select('id, status')
    .eq('seller_id', user.id)
    .in('status', STATI_APERTI)
    .order('created_at', { ascending: false })
    .limit(1);
  if (errAperti) {
    logger.error('catalog-batch start: lettura dei lavori aperti fallita', { sellerId: user.id, status: errAperti.code });
    return ApiErrors.badGateway('Non sono riuscito a controllare i lavori in corso. Riprova.');
  }
  const aperto = (aperti ?? [])[0] as { id: string; status: string } | undefined;
  if (aperto) {
    // R03-002 (giro di correzione) — Un lavoro «in invio» non si applica: si
    // aspetta che l'invio si chiarisca. 21/11/2026 (R02-003 · R02-002) — Se resta
    // senza risposta, dopo qualche minuto si scarta (cancel/route.ts): prima il
    // negozio restava fermo fino a 24 ore.
    const messaggio = aperto.status === 'submitting'
      ? 'Hai già un lavoro sul catalogo il cui invio è ancora da verificare: lo trovi qui sotto. Ricarica la pagina fra qualche minuto; se è ancora senza risposta, puoi scartarlo e avviarne un altro.'
      : 'Hai già un lavoro sul catalogo aperto: lo trovi qui sotto. Applicalo o scartalo prima di avviarne un altro.';
    return apiError(409, messaggio, 'CONFLICT', { jobId: aperto.id, status: aperto.status });
  }

  // 22/11/2026 (R13-001 · R13-009) — UN AVVIO MENTRE UN'APPLICAZIONE È IN CORSO.
  // /apply segna il lavoro «applicato» quando comincia, e lo rimette «pronto» se
  // un guasto di passaggio lo lascia ripetibile. Se in mezzo qui nasce un lavoro
  // nuovo, il database (640: un solo lavoro aperto per negozio) rifiuta il
  // «pronto» e il lavoro pagato resta chiuso. Finche' l'ultimo applicato non ha
  // il segno di fine ed e' di meno di 120 s, si aspetta. 27/11/2026 (R02-004) —
  // Senza la colonna si rilegge senza e si aspetta lo stesso: prima si andava
  // avanti, e l'attesa non scattava mai.
  const leggiApplicati = (colonne: string) =>
    admin
      .from('catalog_ai_jobs')
      .select(colonne)
      .eq('seller_id', user.id)
      .in('status', ['applied'])
      .order('updated_at', { ascending: false })
      .limit(1);
  let { data: applicati, error: errApplicati } = await leggiApplicati(`id, updated_at, ${COLONNA_FINE_APPLICAZIONE}`);
  if (errApplicati && COLONNA_ASSENTE.has(String(errApplicati.code ?? ''))) {
    ({ data: applicati, error: errApplicati } = await leggiApplicati('id, updated_at'));
  }
  if (errApplicati) {
    logger.error('catalog-batch start: lettura dei lavori applicati fallita', { sellerId: user.id, status: errApplicati.code });
    return ApiErrors.badGateway('Non sono riuscito a controllare i lavori in corso. Riprova.');
  }
  const ultimoApplicato = ((applicati ?? []) as unknown[])[0] as
    | { id: string; updated_at?: string | null; applicazione_finita_il?: string | null }
    | undefined;
  if (
    ultimoApplicato &&
    ultimoApplicato.applicazione_finita_il == null &&
    Date.now() - Date.parse(String(ultimoApplicato.updated_at ?? '')) < APPLICAZIONE_MAX_MS
  ) {
    return apiError(
      409,
      'Stai ancora applicando un lavoro sul catalogo: aspetta che finisca (al massimo un paio di minuti), poi avvia il prossimo.',
      'CONFLICT',
      { jobId: ultimoApplicato.id, status: 'applied' },
    );
  }

  const [{ data: productsData }, { data: categoriesData }] = await Promise.all([
    admin
      .from('products')
      .select(PRODUCT_SNAPSHOT_COLS)
      .eq('seller_id', user.id)
      .in('status', ['available', 'draft'])
      .order('created_at', { ascending: false })
      .limit(MAX_PRODUCTS),
    admin.from('categories').select('id, name, slug, parent_id').order('name'),
  ]);

  const tutti = (productsData ?? []) as ProductRow[];
  const categories = (categoriesData ?? []) as CategoryRow[];
  if (tutti.length === 0) {
    return ApiErrors.invalidRequest('Non hai prodotti pubblicati o in bozza su cui lavorare.');
  }
  // 17/11/2026 (R03-012) — LA TRADUZIONE DEL CATALOGO NON TAGLIA IN SILENZIO.
  // Il lotto manda al modello la descrizione tagliata a 4000 caratteri
  // (catalogBatch.ts): per «traduci» tornava tradotto solo l'inizio e,
  // applicato, il resto dell'italiano spariva. Come la traduzione dal modulo,
  // una scheda troppo lunga non si traduce: resta fuori, e lo si dice.
  const troppoLunghi = operation === 'translate' ? tutti.filter(testoTroppoLungoPerTradurre).length : 0;
  const products = troppoLunghi > 0 ? tutti.filter((p) => !testoTroppoLungoPerTradurre(p)) : tutti;
  if (products.length === 0) {
    return ApiErrors.invalidRequest(
      `Descrizioni troppo lunghe per la traduzione automatica: massimo ${MAX_TESTO_TRADUCIBILE} caratteri fra nome e descrizione.`,
    );
  }
  const esclusi = troppoLunghi > 0 ? { esclusiTroppoLunghi: troppoLunghi } : {};

  const requests = buildCatalogBatchRequests({ operation, products, categories, targetLang });

  // 191 — Prima si mandava il lavoro al modello e POI si scriveva la riga che lo
  // traccia. Se quella scrittura falliva, il lavoro era partito, era pagato, e
  // nessuno sapeva più che esistesse: né il negoziante, che vede «riprova», né
  // noi. Ora la riga nasce prima, in stato «in invio»; l'identificativo del
  // lotto ci si aggiunge dopo. Se qualcosa va storto resta una traccia con
  // scritto cosa è successo, e il lotto si recupera a mano.
  // 19/11/2026 (R03-002, giro 2) — La riga nasce col motivo «invio senza
  // risposta»: finche' il lotto non e' agganciato (o l'invio non e' fallito
  // davvero) vale «forse partito», e lo stato la tiene aperta quanto un lotto
  // (24 ore) invece di chiuderla dopo 15 minuti. Cosi' anche se il database
  // rifiuta le scritture dopo l'invio, non se ne paga un secondo.
  const { data: job, error: errJob } = await admin
    .from('catalog_ai_jobs')
    .insert({
      seller_id: user.id,
      operation,
      status: 'submitting',
      target_lang: targetLang ?? null,
      total: products.length,
      error: INVIO_SENZA_RISPOSTA,
    })
    .select('id')
    .single();

  if (errJob || !job) {
    // 21/11/2026 (R02-004 · R02-013) — DUE AVVII INSIEME. La lettura dei lavori
    // aperti qui sopra passa per tutti e due; il database tiene un solo lavoro
    // aperto per negozio (migrazione 640), e il secondo inserimento arriva qui
    // con 23505. Non e' un guasto: e' il lavoro dell'altro avvio, gia' aperto.
    if (errJob?.code === '23505') {
      const { data: altri } = await admin
        .from('catalog_ai_jobs')
        .select('id, status')
        .eq('seller_id', user.id)
        .in('status', STATI_APERTI)
        .order('created_at', { ascending: false })
        .limit(1);
      const altro = (altri ?? [])[0] as { id: string; status: string } | undefined;
      return apiError(
        409,
        'Hai già un lavoro sul catalogo appena avviato: lo trovi qui sotto. Non avviarne un altro.',
        'CONFLICT',
        altro ? { jobId: altro.id, status: altro.status } : undefined,
      );
    }
    logger.error('catalog-batch start: insert job failed', { sellerId: user.id, status: errJob?.code });
    return ApiErrors.badGateway('Non sono riuscito ad aprire il lavoro. Riprova.');
  }

  try {
    /**
     * 22/8/2026 — IL TETTO DI SPESA NON GUARDAVA QUI, ED E' IL POSTO DOVE SI
     * SPENDE DI PIU' IN UN COLPO SOLO.
     *
     * Ogni chiamata singola al modello passa da `runMessage`, che prima
     * controlla il tetto giornaliero e dopo registra quanto ha speso. Il lotto
     * no: manda decine di richieste insieme e non passava da nessuno dei due
     * ganci. Poteva partire col tetto gia' superato — cioe' proprio quando il
     * freno doveva fermarlo — e la sua spesa non veniva contata, quindi il
     * tetto restava fermo mentre i soldi uscivano.
     */
    // R04-017 — Il confronto e' «speso + stima del lotto», non solo «speso»:
    // un lotto da duecento richieste partiva anche a un centesimo dal tetto.
    const impegnato = stimaCostoLottoEur(operation, requests.length);
    const liberaPrenotazione = await controllaTettoSpesaAi('ai-catalog-batch-start', impegnato * 100);
    let handle: Awaited<ReturnType<typeof submitBatch>>;
    try {
      try {
        handle = await submitBatch(requests);
      } catch (errInvio) {
        // R04-014 (revisione) — Un invio senza risposta puo' essere partito, e
        // allora e' pagato: la stima si conta lo stesso (meglio un tetto un
        // po' prudente che una spesa che nessuno vede).
        if (invioIncerto(errInvio)) await registraSpesaAi(impegnato);
        throw errInvio;
      }
      // La spesa si registra PRIMA di togliere la prenotazione: in mezzo non
      // deve esserci un istante in cui il lotto non e' contato da nessuna parte.
      await registraSpesaAi(impegnato);
    } finally {
      await liberaPrenotazione?.();
    }
    /**
     * 27/8/2026 (R143) — SI CONTROLLAVA IL TETTO E NON SI REGISTRAVA NIENTE.
     *
     * La spesa del lotto entrava nel conto solo dentro la rotta che legge lo
     * stato del lavoro, e solo se il venditore tornava a guardare la pagina E
     * il lotto risultava finito. Chi la chiudeva e non tornava portava via
     * fino a duecento chiamate al modello che non contava nessuno — cinque
     * avvii all'ora per venditore.
     *
     * Adesso appena il lavoro e' partito si impegna la stima. Quando i
     * risultati arrivano, `status` aggiunge solo la differenza fra il costo
     * vero e questa stima: i soldi si contano una volta sola, ma subito.
     */
    logger.info('[ai] spesa del lotto impegnata alla partenza', {
      jobId: job.id, richieste: requests.length, stimaEur: impegnato.toFixed(4),
    });
    // R04-005 — Agganciare il lotto alla riga si ritenta una volta: se non
    // riesce, la risposta dice lo stato VERO («in invio»), non «in corso».
    const aggancia = () =>
      admin.from('catalog_ai_jobs').update({ status: 'processing', batch_id: handle.id, error: null }).eq('id', job.id);
    let { error: errUpd } = await aggancia();
    if (errUpd) ({ error: errUpd } = await aggancia());

    if (errUpd) {
      // Il lavoro è partito davvero: l'identificativo va nel log, così il lotto
      // resta recuperabile dalla console anche se il database non l'ha preso.
      logger.error('catalog-batch start: batch avviato ma non agganciato', {
        sellerId: user.id, jobId: job.id, batchId: handle.id,
      });
      // R03-003 — Il lotto e' partito ed e' pagato: la riga lo dice nel motivo,
      // con il suo id. Lo stato (status/route.ts) lo aggancia da li' invece di
      // chiudere la riga come fallita dopo 15 minuti e lasciarne pagare un altro.
      // Se anche questa scrittura e' rifiutata la riga resta «forse partito»
      // (il motivo con cui e' nata): aperta, e niente secondo lotto pagato.
      const { error: errMotivo } = await admin
        .from('catalog_ai_jobs')
        .update({ error: `lotto partito ma non agganciato: ${handle.id}` })
        .eq('id', job.id);
      if (errMotivo) logger.error('catalog-batch start: motivo del lotto non agganciato rifiutato', { jobId: job.id, batchId: handle.id, status: errMotivo.code });
      return NextResponse.json({ jobId: job.id, total: products.length, status: 'submitting', ...esclusi });
    }

    return NextResponse.json({ jobId: job.id, total: products.length, status: 'processing', ...esclusi });
  } catch (err) {
    // R04-014 — Un invio rimasto senza risposta puo' essere partito: non lo si
    // dichiara fallito (e non si rimanda). La riga resta «in invio» con il
    // motivo, cosi' il lavoro aperto blocca un secondo avvio e si verifica.
    if (invioIncerto(err)) {
      // R03-002 (giro 2) — Se il database la rifiuta, la riga ha gia' questo
      // motivo dalla nascita: resta aperta come «forse partito».
      const { error: errMotivo } = await admin
        .from('catalog_ai_jobs')
        .update({ error: INVIO_SENZA_RISPOSTA })
        .eq('id', job.id);
      if (errMotivo) logger.error('catalog-batch start: motivo dell\'invio senza risposta rifiutato', { jobId: job.id, status: errMotivo.code });
      logger.error('catalog-batch start: invio del lotto senza risposta, da verificare', { sellerId: user.id, jobId: job.id });
      return ApiErrors.unavailable(
        'L\'invio non ha avuto risposta: il lavoro potrebbe essere partito. Non riavviarlo: ricarica la pagina fra qualche minuto, e se è ancora senza risposta puoi scartarlo.',
      );
    }
    // R03-002 (giro di correzione) — Il lavoro non e' partito: la riga, nata
    // «forse partito», va chiusa. Come l'aggancio, la scrittura si ritenta una
    // volta: se il database la rifiuta, la riga resterebbe aperta per 24 ore e
    // il negozio non potrebbe ripartire.
    const chiudi = async (valori: { status: 'canceled' | 'failed'; error: string | null }) => {
      const scrivi = () => admin.from('catalog_ai_jobs').update(valori).eq('id', job.id);
      let { error: errChiudi } = await scrivi();
      if (errChiudi) ({ error: errChiudi } = await scrivi());
      if (errChiudi) {
        logger.error('catalog-batch start: chiusura del lavoro mai partito rifiutata', {
          jobId: job.id, stato: valori.status, status: errChiudi.code,
        });
      }
    };
    // R03-002 — Il tetto di spesa del giorno non e' un guasto: il lavoro non e'
    // partito e non e' costato niente. Non si segna «fallito» e non si dice
    // «riprova»: si dice che il budget AI del giorno e' finito.
    if (err instanceof AiCallError && err.motivo === 'tetto_spesa') {
      await chiudi({ status: 'canceled', error: 'tetto di spesa AI del giorno raggiunto: il lavoro non è partito' });
      return mapAiError(err, 'ai-catalog-batch-start');
    }
    // 26/11/2026 (R20-008) — Il conto della spesa che non risponde non e' il
    // tetto raggiunto: il lavoro non e' partito per un guasto di minuti. La riga
    // si chiude (cosi' non blocca un nuovo avvio) senza dire «budget finito», e
    // il negoziante legge di riprovare fra qualche minuto.
    if (err instanceof AiCallError && err.motivo === 'spesa_sconosciuta') {
      await chiudi({ status: 'failed', error: 'conto della spesa AI momentaneamente non raggiungibile: il lavoro non è partito, si può riprovare' });
      return mapAiError(err, 'ai-catalog-batch-start');
    }
    // Fallito davvero: il motivo «forse partito» con cui la riga e' nata va tolto.
    await chiudi({ status: 'failed', error: null });
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    logger.error('catalog-batch start: submit failed', { sellerId: user.id, jobId: job.id });
    return ApiErrors.badGateway('Non sono riuscito ad avviare il lavoro. Riprova.');
  }
});

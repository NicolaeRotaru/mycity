import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { withSellerAuth } from '@/lib/api/middleware';
import { AI_NEGOZI_ACCESA } from '@/lib/funzioni-al-lancio';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { MAX_DESCRIZIONE_PRODOTTO, MAX_NOME_PRODOTTO, resolveAiPatch, testoDelPatch, type CategoryRow } from '@/lib/products/aiPatch';
import { PRODUCT_SNAPSHOT_COLS, type ProductRow } from '@/lib/products/aiSnapshot';
import type { CatalogJobResult, CatalogOperation } from '@/lib/ai/catalogBatch';
import { senzaCampiEconomici, operazioneAccesa } from '@/lib/ai/catalogBatch';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { classifyProductPolicy } from '@/lib/ai/moderation';
import { cosaMancaDopoLaModifica } from '@/lib/products/prontoPerLaVendita';
import { tracciaDellaModifica } from '@/lib/products/salvataggio-tracciato';

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

type EsitoProdotto = { productId: string; esito: 'applicato' | 'saltato'; motivo?: string };

/** Quante chiamate al filtro dei contenuti partono insieme. */
const FILTRI_INSIEME = 5;

/**
 * 24/11/2026 (R01-003) — La rotta ha 120 s (vercel.json). Il filtro ha un tempo suo (10 s,
 * lib/ai/moderation.ts), ma con 5 filtri insieme 200 righe sono 40 gruppi in fila: con un
 * fornitore lento si sforava, 504, niente scritto, filtri gia' pagati e il lavoro fermo
 * «applicato». Come catalog-apply-bulk: dopo 70 s nessun gruppo nuovo parte (quelli in volo
 * hanno al massimo 10 s), e chi resta fuori non si scrive, si dice e si rimanda.
 */
const FILTRI_ENTRO_MS = 70_000;
const MOTIVO_NON_CONTROLLATO = 'non controllato in tempo: rimandalo';

/** I motivi dei saltati «di passaggio», quelli che lasciano il lavoro ripetibile. */
const MOTIVI_DI_PASSAGGIO = new Set([
  'filtro dei contenuti non disponibile: riprova più tardi',
  'scrittura non riuscita',
  MOTIVO_NON_CONTROLLATO,
]);

/**
 * Come Promise.allSettled, ma al massimo `quanti` lavori alla volta. Passata la
 * `scadenza` nessun gruppo nuovo parte: le sue voci restano senza esito.
 */
async function aGruppi<T, R>(
  voci: T[],
  quanti: number,
  lavoro: (v: T) => Promise<R>,
  scadenza: number = Infinity,
): Promise<(PromiseSettledResult<R> | undefined)[]> {
  const esiti: (PromiseSettledResult<R> | undefined)[] = [];
  for (let i = 0; i < voci.length; i += quanti) {
    if (Date.now() > scadenza) break;
    esiti.push(...(await Promise.allSettled(voci.slice(i, i + quanti).map(lavoro))));
  }
  return esiti;
}

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  const inizio = Date.now();
  // Spento al lancio (carta #209): un lavoro rimasto «pronto» non si applica a
  // mano. Senza modello il filtro dice «no» a nome e descrizione, e il lavoro si
  // chiuderebbe «applicato» con dentro solo tag e categoria.
  if (!AI_NEGOZI_ACCESA) return ApiErrors.unavailable('Gli strumenti AI per i negozi non sono ancora attivi.');
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
  if (!Array.isArray(body.productIds)) return ApiErrors.invalidRequest('Scegli i prodotti a cui applicare le modifiche.');
  const onlyIds = new Set(body.productIds.filter((s): s is string => typeof s === 'string'));

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
  // «Traduci» spento (carta #209): il prodotto ha un nome solo, quindi un lotto di
  // traduzione sostituirebbe l'italiano su tutto il catalogo. Ferma anche un
  // lavoro nato prima dello spegnimento.
  if (!operazioneAccesa(job.operation)) {
    return ApiErrors.invalidRequest('Questo lavoro non si può applicare: la traduzione del catalogo non è attiva.');
  }

  const results = (Array.isArray(job.results) ? job.results : []).filter(
    (r) => r.product_id && onlyIds.has(r.product_id),
  );
  if (results.length === 0) return ApiErrors.invalidRequest('Nessun risultato da applicare.');

  // S10 (5/11/2026) — «pronto?» e «applicato» erano due passi separati: due
  // «Applica» partiti insieme passavano tutti e due, e la spesa del filtro e le
  // righe di audit raddoppiavano. Adesso il lavoro si prenota con un passaggio
  // solo, che riesce a una richiesta sola.
  const { data: prenotato, error: errorePrenotazione } = await admin
    .from('catalog_ai_jobs')
    .update({ status: 'applied', updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('seller_id', user.id)
    .eq('status', 'ready')
    .select('id');
  if (errorePrenotazione) return ApiErrors.unavailable('Non riesco ad aprire il lavoro in questo momento. Riprova fra poco.');
  if (!prenotato || (prenotato as unknown[]).length === 0) {
    return ApiErrors.invalidRequest('Questo lavoro si sta già applicando o è già stato applicato.');
  }

  const { data: categoriesData, error: erroreCategorie } = await admin
    .from('categories')
    .select('id, name, slug, parent_id')
    .order('name');
  // Revisione S10 — Una lettura caduta non deve chiudere il lavoro: si rimette
  // «pronto» e si dice di riprovare (come in catalog-apply-bulk).
  // 24/11/2026 (R01-001) — E l'errore si legge: prima nessuno lo guardava, il
  // lavoro restava «applicato» e la risposta diceva «puoi riprovare». Il 23505 e'
  // la 640 (un solo lavoro aperto per negozio): nel frattempo il negozio ha
  // avviato un altro lavoro, e questo non puo' piu' tornare pronto. Torna il
  // perche', o null se e' tornato pronto.
  const rimettiPronto = async (risultati?: unknown[]): Promise<string | null> => {
    const { error } = await admin
      .from('catalog_ai_jobs')
      .update({ status: 'ready', updated_at: new Date().toISOString(), ...(risultati ? { results: risultati } : {}) })
      .eq('id', job.id)
      .eq('seller_id', user.id);
    if (!error) return null;
    logger.error('catalog-batch apply: lavoro non rimesso pronto', { jobId: job.id, sellerId: user.id, status: error.code });
    return error.code === '23505'
      ? 'nel frattempo hai avviato un altro lavoro sul catalogo, e questo non può più tornare pronto da ripetere'
      : 'non sono riuscito a rimettere il lavoro pronto da ripetere';
  };
  /**
   * 28/11/2026 (R02-003, onda 2) — IL SEGNO DI FINE DELL'APPLICAZIONE.
   *
   * L'avvio di un lavoro nuovo (start/route.ts) aspetta finche' l'ultimo lavoro «applicato» non ha
   * il segno di fine (`applicazione_finita_il`) ed e' di meno di 120 s: se un lavoro nuovo nascesse
   * a meta' applicazione, il database (640) rifiuterebbe il ritorno a «pronto» di questo. Ma il segno
   * non lo scriveva nessuno: ogni avvio dopo un'applicazione finita aspettava due minuti per niente.
   * Si scrive quando il lavoro resta «applicato» per sempre (finito, o non piu' rimettibile pronto).
   * Una scrittura a parte e senza conseguenze: senza la colonna (migrazione 999m non
   * applicata) fallisce, e l'avvio aspetta i 120 s come prima.
   */
  const segnaFineApplicazione = async (): Promise<void> => {
    const { error } = await admin
      .from('catalog_ai_jobs')
      .update({ applicazione_finita_il: new Date().toISOString() })
      .eq('id', job.id)
      .eq('seller_id', user.id)
      .eq('status', 'applied');
    if (error) logger.warn('catalog-batch apply: segno di fine non scritto', { jobId: job.id, status: error.code });
  };
  if (erroreCategorie) {
    const nonRimesso = await rimettiPronto();
    if (nonRimesso) await segnaFineApplicazione();
    return ApiErrors.unavailable(
      nonRimesso
        ? `Non riesco a leggere le categorie in questo momento e non ho cambiato niente, ma ${nonRimesso}.`
        : 'Non riesco a leggere le categorie in questo momento. Riprova fra poco: non ho cambiato niente.',
    );
  }
  const categories = (categoriesData ?? []) as CategoryRow[];

  let applied = 0;
  // S10 (5/11/2026) — Per ogni prodotto l'esito e il motivo: prima la risposta
  // dava solo un numero, e chi era stato saltato spariva in silenzio.
  const esiti: EsitoProdotto[] = [];
  // Un salto «di passaggio» (filtro caduto, scrittura non riuscita) lascia il
  // lavoro ripetibile: il lavoro pagato non si butta per un guasto di un attimo.
  let ripetibile = false;
  // R08-001 — Chi ha avuto dal filtro un verdetto VERO di blocco in questo giro: se il lavoro torna
  // pronto, il verdetto e la sua impronta restano nei risultati e al giro dopo non si ripaga.
  const bloccatiDalFiltro = new Map<string, { impronta: string; motivo: string }>();

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
      // Qui NON si rimette «pronto»: ripetere rimetterebbe in bozza anche un
      // prodotto che nel frattempo il negoziante ha ripubblicato a mano. Si
      // dice chi e' saltato, e basta.
      applied = (updated ?? []).length;
      const messiInBozza = new Set(((updated ?? []) as Array<{ id: string }>).map((r) => r.id));
      for (const id of flaggedIds) {
        esiti.push(
          messiInBozza.has(id)
            ? { productId: id, esito: 'applicato' }
            : { productId: id, esito: 'saltato', motivo: 'scrittura non riuscita' },
        );
      }
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
      const { data: rows, error: erroreProdotti } = await admin
        .from('products')
        .select(`${PRODUCT_SNAPSHOT_COLS}, seller_id`)
        .eq('seller_id', user.id)
        .in('id', ids);
      if (erroreProdotti) {
        const nonRimesso = await rimettiPronto();
        if (nonRimesso) await segnaFineApplicazione();
        return ApiErrors.unavailable(
          nonRimesso
            ? `Non riesco a leggere il catalogo in questo momento e non ho cambiato niente, ma ${nonRimesso}.`
            : 'Non riesco a leggere il catalogo in questo momento. Riprova fra poco: non ho cambiato niente.',
        );
      }
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
      // R01-003 — Un testo che e' gia' quello del catalogo non e' nuovo e non si rifiltra:
      // cosi' un lavoro rimandato riparte da chi e' rimasto fuori, invece di rifare sempre i
      // primi e lasciare fuori gli stessi.
      // R08-001 — Ma un testo uguale non vuol dire «niente di nuovo»: se la proposta lo ripete con
      // tag, categoria o altro che cambiano davvero, quello si scrive, e il testo gia' in catalogo
      // (magari vietato) passa dal filtro come tutto il resto. Quel che cambia lo dice
      // `resolveAiPatch`, lo stesso che poi scrive.
      const testoNuovo = (v: unknown, attuale: string | null, massimo: number) =>
        typeof v === 'string' && testoDelPatch(v, massimo) !== attuale;
      const cambiaQualcosaDiAltro = (r: CatalogJobResult, row: ProductRow): boolean => {
        const { update } = resolveAiPatch({
          patch: senzaCampiEconomici(r.patch ?? {}),
          current: { attributes: row.attributes ?? null, category_id: row.category_id, has_variants: row.has_variants, price: row.price },
          categories,
        });
        const attuale = row as unknown as Record<string, unknown>;
        return Object.entries(update).some(
          ([k, v]) => k !== 'name' && k !== 'description' && k in attuale && JSON.stringify(v) !== JSON.stringify(attuale[k]),
        );
      };
      const daFiltrareTutti = results.filter((r) => {
        if (!r.patch || Object.keys(r.patch).length === 0) return false;
        const row = current.get(r.product_id);
        if (!row) return false;
        const patch = r.patch as Record<string, unknown>;
        return (
          testoNuovo(patch.name, row.name, MAX_NOME_PRODOTTO) ||
          testoNuovo(patch.description, row.description, MAX_DESCRIZIONE_PRODOTTO) ||
          ((typeof patch.name === 'string' || typeof patch.description === 'string') && cambiaQualcosaDiAltro(r, row))
        );
      });
      // R08-001 — Chi e' gia' stato BLOCCATO dal filtro (verdetto vero, non un errore o un tempo scaduto)
      // con la stessa proposta non si rifiltra e non si ripaga: resta bloccato col suo motivo, e il tempo
      // va a chi non e' ancora controllato. Se la proposta cambia, l'impronta non torna e si rifiltra.
      const testoPerIlFiltro = (r: CatalogJobResult) => {
        const row = current.get(r.product_id) as ProductRow;
        const patch = r.patch as Record<string, unknown>;
        return {
          name: typeof patch.name === 'string' ? patch.name : (row.name ?? ''),
          description: typeof patch.description === 'string' ? patch.description : (row.description ?? ''),
        };
      };
      const improntaDi = (r: CatalogJobResult) =>
        createHash('sha1').update(JSON.stringify([testoPerIlFiltro(r), r.patch])).digest('hex');
      const bloccoRicordato = (r: CatalogJobResult): string | null => {
        const m = (r as CatalogJobResult & { filtro_bloccato?: { impronta?: unknown; motivo?: unknown } }).filtro_bloccato;
        return m && typeof m.motivo === 'string' && m.impronta === improntaDi(r) ? m.motivo : null;
      };
      const daFiltrare = daFiltrareTutti.filter((r) => bloccoRicordato(r) === null);
      // S10 (5/11/2026) — Prima partivano fino a duecento chiamate tutte
      // insieme: una raffica di «troppe richieste» faceva scartare come
      // vietati anche i prodotti puliti. Adesso al massimo FILTRI_INSIEME alla
      // volta, e un filtro caduto non si chiama «vietato».
      const verdetti = await aGruppi(
        daFiltrare,
        FILTRI_INSIEME,
        (r) => classifyProductPolicy(testoPerIlFiltro(r), 'catalog-batch-apply-policy'),
        inizio + FILTRI_ENTRO_MS,
      );
      // Chi non passa — o su cui il filtro e' caduto — non si scrive: nel
      // dubbio si nega, come fa il filtro stesso quando risponde.
      const bloccati = new Map<string, string>();
      for (const r of daFiltrareTutti) {
        const ricordato = bloccoRicordato(r);
        if (ricordato !== null) bloccati.set(r.product_id, ricordato);
      }
      daFiltrare.forEach((r, i) => {
        const esito = verdetti[i];
        if (!esito) {
          // R01-003 — Non controllato in tempo: non si scrive, e il lavoro torna
          // «pronto» perche' si possa rimandare.
          bloccati.set(r.product_id, MOTIVO_NON_CONTROLLATO);
          ripetibile = true;
        } else if (esito.status === 'rejected') {
          bloccati.set(r.product_id, 'filtro dei contenuti non disponibile: riprova più tardi');
          ripetibile = true;
        } else if (!esito.value.allowed) {
          const motivo = `bloccato dal filtro dei contenuti${esito.value.reason ? `: ${esito.value.reason}` : ''}`;
          bloccati.set(r.product_id, motivo);
          bloccatiDalFiltro.set(r.product_id, { impronta: improntaDi(r), motivo });
        }
      });
      if (bloccati.size > 0) {
        logger.warn('catalog-batch apply: modifiche scartate dal filtro', {
          sellerId: user.id,
          scartati: bloccati.size,
          controllati: daFiltrare.length,
        });
      }

      for (const r of results) {
        const bloccato = bloccati.get(r.product_id);
        if (bloccato) {
          esiti.push({ productId: r.product_id, esito: 'saltato', motivo: bloccato });
          continue;
        }
        if (!r.patch || Object.keys(r.patch).length === 0) continue;
        const row = current.get(r.product_id);
        if (!row) {
          esiti.push({ productId: r.product_id, esito: 'saltato', motivo: 'prodotto non trovato nel tuo catalogo' });
          continue;
        }
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
        if (Object.keys(update).length === 0) {
          esiti.push({ productId: r.product_id, esito: 'saltato', motivo: 'nessuna modifica valida' });
          continue;
        }
        // R36 — Il lotto non tocca lo stato, ma puo' cambiare categoria: un
        // prodotto in vendita spostato fra gli alimentari senza allergeni e
        // ingredienti non si scrive.
        // S10 (5/11/2026) — Si scarta solo il cambio di categoria, non tutta la
        // modifica: nome e descrizione migliorati si scrivono lo stesso.
        let notaCategoria: string | undefined;
        const mancanti = cosaMancaDopoLaModifica({ prima: row, update, categories });
        if (mancanti.length > 0) {
          const senzaCategoria = { ...update };
          delete senzaCategoria.category_id;
          delete senzaCategoria.subcategory_id;
          delete senzaCategoria.attributes;
          const ancoraMancanti =
            Object.keys(senzaCategoria).length > 0
              ? cosaMancaDopoLaModifica({ prima: row, update: senzaCategoria, categories })
              : mancanti;
          if (Object.keys(senzaCategoria).length === 0 || ancoraMancanti.length > 0) {
            esiti.push({ productId: r.product_id, esito: 'saltato', motivo: `campi obbligatori mancanti: ${mancanti.join(', ')}` });
            continue;
          }
          for (const k of Object.keys(update)) delete update[k];
          Object.assign(update, senzaCategoria);
          notaCategoria = `categoria non cambiata, mancano: ${mancanti.join(', ')}`;
        }
        const { error } = await admin
          .from('products')
          .update(update)
          .eq('id', r.product_id)
          .eq('seller_id', user.id);
        if (error) {
          ripetibile = true;
          esiti.push({ productId: r.product_id, esito: 'saltato', motivo: 'scrittura non riuscita' });
        } else {
          applied += 1;
          esiti.push({ productId: r.product_id, esito: 'applicato', ...(notaCategoria ? { motivo: notaCategoria } : {}) });
          // #196 — Il lavoro massivo tocca decine di prodotti in un colpo: senza
          // traccia, se qualcosa esce storto non si sa neanche da dove partire.
          // 17/11/2026 — La voce la costruisce `tracciaDellaModifica`, come in
          // catalog-apply e nel modulo del prodotto: solo i campi cambiati, con
          // `daAi`. Prima qui si scriveva a mano la forma vecchia.
          const voce = tracciaDellaModifica({
            prodottoId: r.product_id,
            attoreId: user.id,
            origine: `ai-batch:${job.operation}`,
            prima: row as unknown as Record<string, unknown>,
            dopo: update,
            campiDallAi: Object.keys(update),
          });
          if (voce) void writeAudit(voce);
        }
      }
    }
  }

  // Il lavoro e' gia' segnato «applicato» dalla prenotazione. Se qualcosa e'
  // saltato per un guasto di passaggio torna «pronto», cosi' si puo' ripetere.
  // Ripetere riscrive anche i prodotti gia' entrati con lo stesso testo (una
  // riga di audit in piu'; il filtro si rifa' solo per chi ha qualcosa di nuovo da scrivere): e' il prezzo per non buttare il
  // lavoro pagato.
  let avviso: string | undefined;
  if (ripetibile) {
    // R08-001 — Il lavoro torna pronto portandosi dietro il verdetto di chi il filtro ha bloccato davvero.
    const risultatiMarcati =
      bloccatiDalFiltro.size > 0
        ? (Array.isArray(job.results) ? job.results : []).map((r) => {
            const m = bloccatiDalFiltro.get(r.product_id);
            return m ? { ...r, filtro_bloccato: m } : r;
          })
        : undefined;
    const nonRimesso = await rimettiPronto(risultatiMarcati);
    if (nonRimesso) {
      // R01-001 — Il lavoro resta chiuso: i saltati «di passaggio» non si
      // ripetono piu' da qui, e si dice perche' invece di «riprova».
      ripetibile = false;
      avviso = nonRimesso;
      for (const e of esiti) {
        if (e.esito === 'saltato' && e.motivo && MOTIVI_DI_PASSAGGIO.has(e.motivo)) e.motivo = `${e.motivo.split(':')[0]}: ${nonRimesso}`;
      }
    }
  }

  // R02-003 (onda 2) — Il lavoro resta «applicato»: l'applicazione e' finita, e l'avvio dopo non aspetta.
  if (!ripetibile) await segnaFineApplicazione();

  const saltati = esiti.filter((e) => e.esito === 'saltato').length;
  if (saltati > 0) {
    logger.warn('catalog-batch apply: prodotti saltati', { jobId: job.id, sellerId: user.id, saltati, ripetibile });
  }
  logger.info('catalog-batch applied', { jobId: job.id, operation: job.operation, applied });
  return NextResponse.json({ ok: true, applied, saltati, ripetibile, esiti, ...(avviso ? { avviso } : {}) });
});

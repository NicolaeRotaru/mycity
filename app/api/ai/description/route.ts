import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { tagliaAllUltimaFraseIntera } from '@/lib/ai/taglia-alla-frase';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';
import { assertSafeText, UnsafeContentError } from '@/lib/ai/moderation';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
// 27/8/2026 (R150) — La riga che dice al modello che la descrizione da
// migliorare e' un DATO e non un ordine: molte le hanno scritte altri
// marketplace, non il venditore.
import { REGOLA_TESTO_DI_TERZI, recinta } from '@/lib/ai/recinto';

/**
 * AI Description Writer per seller.
 *
 * Esperti senior consultati:
 * - Marketplace PM: "Description scrivere è il dolore #1 del seller."
 * - Trust & Safety: "Solo seller approvati. Rate limit aggressivo."
 * - Finance: "Cap 20 calls/utente/giorno. Claude Haiku per cost-efficacy."
 */

export const runtime = 'nodejs';

// Istruzioni di sistema (stabili → cacheabili). I dati del prodotto vanno nel
// messaggio utente come DATO, mai qui: confine netto = anti prompt-injection.
const SYSTEM = `Sei un copywriter per il marketplace locale "MyCity Piacenza".
Scrivi una descrizione prodotto in italiano, calda e onesta, di 200-350 caratteri.

Stile:
- Italiano vivo, no anglicismi.
- Massimo 3 frasi.
- Prima frase = che cos'è il prodotto in modo concreto.
- Ultima frase può menzionare provenienza locale o consigli d'uso.
- NIENTE emoji, niente hashtag, niente prezzi.

Rispondi SOLO con la descrizione, niente preambolo, niente virgolette.

${REGOLA_TESTO_DI_TERZI}`;

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');

  // Rate limit: 20 calls / giorno per utente
  const rl = await rateLimitAsync({
    key: `ai-desc:${user.id}`,
    max: 20,
    windowMs: 24 * 60 * 60_000,
  });
  if (!rl.allowed) {
    return ApiErrors.rateLimited(rl.retryAfterSec);
  }

  let body: { name?: string; current?: string; category?: string };
  try {
    body = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    // (R153) Troppo grande e malformato non sono la stessa cosa: il perche' e'
    // scritto per esteso in app/api/ai/catalog-chat/route.ts.
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('JSON non valido');
  }
  // 22/8/2026 — I TAGLI STAVANO IN UN PUNTO SOLO DEI DUE.
  //
  // La descrizione attuale finiva tagliata a 500 caratteri nel blocco che va
  // al modello, ma entrava intera nel filtro di conformita' qui sotto. Nome e
  // categoria non erano tagliati da nessuna delle due parti. Un campo lungo
  // non fa danni gravi (venti chiamate al giorno per venditore, modello
  // piccolo), ma i due percorsi devono leggere lo stesso testo: se il filtro
  // vede piu' del modello, o meno, non sta piu' controllando cio' che esce.
  //
  // Adesso si taglia una volta sola, subito dopo il parse, e si usano queste
  // tre variabili in tutti e due i posti.
  const name = body.name?.trim().slice(0, 200);
  const attuale = (body.current ?? '').slice(0, 500);
  const categoria = (body.category ?? '').slice(0, 100);
  if (!name || name.length < 2) {
    return ApiErrors.invalidRequest('Specifica il nome del prodotto');
  }

  // Fetch store_name per il prompt (client RLS: il seller legge il proprio profilo)
  let storeName = '—';
  try {
    const supa = await getServerSupabase();
    const { data: profile } = await supa.from('profiles').select('store_name').eq('id', user.id).single();
    if (profile?.store_name) storeName = profile.store_name;
  } catch {
    // store_name è opzionale per il prompt: prosegui con '—'.
  }

  // #5 — IL FILTRO ESISTEVA, SCRITTO PER INTERO, E NON ERA COLLEGATO A NIENTE.
  //
  // lib/ai/moderation.ts contiene un filtro Trust & Safety completo, con le
  // categorie vietate e la regola «nel dubbio si blocca». Il commento in cima
  // diceva «da cablare nelle route in PR successive», e quelle PR non sono mai
  // arrivate: cercando i suoi nomi in tutto il progetto si trovavano zero usi
  // fuori dal file stesso.
  //
  // In un'ispezione DSA un filtro che esiste e non gira è peggio di uno che
  // non c'è, perché prova che il rischio era stato riconosciuto. Qui passa il
  // testo libero che il venditore manda al modello: è la porta scoperta.
  try {
    await assertSafeText(
      [name, attuale, categoria].filter(Boolean).join('\n'),
      'ai-description-policy',
    );
  } catch (err) {
    if (err instanceof UnsafeContentError) {
      return ApiErrors.invalidRequest(`Questo testo non si puo' usare: ${err.verdict.reason}`);
    }
    // Il filtro è una chiamata al modello come le altre: se quella cade, la
    // risposta dev'essere la stessa che darebbe la generazione, non un errore
    // non gestito che arriva al browser come 500 muto.
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-description-policy');
    return ApiErrors.internal('Errore AI.');
  }

  // Dati utente come DATO (in messages), mai come istruzioni (system).
  const userBlock = `Negozio: ${storeName}
Categoria: ${categoria || '—'}
Nome prodotto: ${recinta('nome', name, 200)}
${attuale ? `Descrizione attuale (da migliorare): ${recinta('descrizione', attuale, 500)}` : ''}`;

  try {
    // `seTagliata: 'accetta'` e' voluto: con 300 token il taglio qui e' la normalita', e per il
    // negoziante che sta caricando la merce col telefono in mano una descrizione un po' piu' corta
    // vale piu' di un errore. Quello che NON gli diamo e' una riga mozza a meta' parola: il testo
    // viene chiuso all'ultima frase intera.
    const { text, tagliata } = await runMessage({
      feature: 'ai-description',
      model: MODELS.fast,
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: 'user', content: userBlock }],
      seTagliata: 'accetta',
    });
    const description = tagliata ? tagliaAllUltimaFraseIntera(text ?? '') : (text ?? '');
    if (!description) return ApiErrors.internal('Nessuna risposta dal modello.');
    return NextResponse.json({ description });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-description');
    return ApiErrors.internal('Errore AI.');
  }
});

import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';

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

Rispondi SOLO con la descrizione, niente preambolo, niente virgolette.`;

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');

  // Rate limit: 20 calls / giorno per utente
  const rl = rateLimit({
    key: `ai-desc:${user.id}`,
    max: 20,
    windowMs: 24 * 60 * 60_000,
  });
  if (!rl.allowed) {
    return ApiErrors.rateLimited(rl.retryAfterSec);
  }

  let body: { name?: string; current?: string; category?: string };
  try {
    body = await req.json();
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }
  const name = body.name?.trim();
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

  // Dati utente come DATO (in messages), mai come istruzioni (system).
  const userBlock = `Negozio: ${storeName}
Categoria: ${body.category ?? '—'}
Nome prodotto: ${name}
${body.current ? `Descrizione attuale (da migliorare): ${body.current.slice(0, 500)}` : ''}`;

  try {
    const { text } = await runMessage({
      feature: 'ai-description',
      model: MODELS.fast,
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: 'user', content: userBlock }],
    });
    if (!text) return ApiErrors.internal('Nessuna risposta dal modello.');
    return NextResponse.json({ description: text });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-description');
    return ApiErrors.internal('Errore AI.');
  }
});

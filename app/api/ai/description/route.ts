import { type NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

/**
 * AI Description Writer per seller.
 *
 * Esperti senior consultati:
 * - Marketplace PM: "Description scrivere è il dolore #1 del seller."
 * - Trust & Safety: "Solo seller approvati. Rate limit aggressivo."
 * - Finance: "Cap 20 calls/utente/giorno. Claude Haiku per cost-efficacy."
 */

export const runtime = 'nodejs';

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return ApiErrors.unavailable('Servizio AI non configurato.');

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

  // Fetch store_name per il prompt
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supa = createClient(url, key, { auth: { persistSession: false } });
  const { data: profile } = await supa.from('profiles').select('store_name').eq('id', user.id).single();

  const client = new Anthropic({ apiKey });
  const prompt = `Sei un copywriter per il marketplace locale "MyCity Piacenza".
Scrivi una descrizione prodotto in italiano, calda e onesta, di 200-350 caratteri.

Stile:
- Italiano vivo, no anglicismi.
- Massimo 3 frasi.
- Prima frase = che cos'è il prodotto in modo concreto.
- Ultima frase può menzionare provenienza locale o consigli d'uso.
- NIENTE emoji, niente hashtag, niente prezzi.

Negozio: ${profile?.store_name ?? '—'}
Categoria: ${body.category ?? '—'}
Nome prodotto: ${name}
${body.current ? `Descrizione attuale (da migliorare): ${body.current.slice(0, 500)}` : ''}

Rispondi SOLO con la descrizione, niente preambolo, niente virgolette.`;

  try {
    const completion = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = completion.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join(' ')
      .trim();
    if (!text) return ApiErrors.internal('Nessuna risposta dal modello.');
    return NextResponse.json({ description: text });
  } catch (err) {
    return ApiErrors.internal(`Errore AI: ${err instanceof Error ? err.message : 'sconosciuto'}`);
  }
});

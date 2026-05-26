import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';

/**
 * AI Description Writer per seller.
 *
 * Esperti senior consultati:
 * - Marketplace PM: "Description scrivere è il dolore #1 del seller. AI
 *   risolve = + onboarding speed, + prodotti pubblicati."
 * - Content Designer: "Scrive in stile MyCity: caldo, locale, italiano vivo.
 *   No generic e-commerce blurb."
 * - SEO Specialist: "200-400 char, primo 50 char keyword-rich.
 *   Mention provenance se locale."
 * - Trust & Safety: "Solo seller approvati. Rate limit aggressivo per cost
 *   protection."
 * - Finance: "Cap a 20 calls/utente/giorno. Claude Haiku per cost-efficacy."
 */

export const runtime = 'nodejs';

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonError(503, 'Servizio AI non configurato sul server.');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    return jsonError(503, 'Servizio non configurato.');
  }

  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null;
  if (!bearer) {
    return jsonError(401, 'Autenticazione richiesta.');
  }

  const supaAuth = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResp, error: userErr } = await supaAuth.auth.getUser(bearer);
  const user = userResp?.user;
  if (userErr || !user) {
    return jsonError(401, 'Sessione non valida.');
  }

  const { data: profile } = await supaAuth
    .from('profiles')
    .select('role, is_approved, store_name')
    .eq('id', user.id)
    .single();

  const role = profile?.role as string | undefined;
  if (!profile?.is_approved || (role !== 'seller' && role !== 'admin')) {
    return jsonError(403, 'Solo i venditori possono usare l\'AI.');
  }

  // Rate limit: 20 calls / giorno per utente
  const rl = rateLimit({
    key: `ai-desc:${user.id}`,
    max: 20,
    windowMs: 24 * 60 * 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Hai raggiunto il limite giornaliero (20 generazioni). Riprova tra ${Math.ceil(rl.retryAfterSec / 3600)}h.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  let body: { name?: string; current?: string; category?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'JSON non valido');
  }
  const name = body.name?.trim();
  if (!name || name.length < 2) {
    return jsonError(400, 'Specifica il nome del prodotto');
  }

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
    if (!text) return jsonError(502, 'Nessuna risposta dal modello.');
    return NextResponse.json({ description: text });
  } catch (err: any) {
    return jsonError(502, `Errore AI: ${err?.message ?? 'sconosciuto'}`);
  }
}

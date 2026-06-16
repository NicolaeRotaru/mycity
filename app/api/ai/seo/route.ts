import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';
import { buildProductContext, type ProductContextInput } from '@/lib/ai/productContext';

/**
 * SEO: ottimizza titolo e tag di un prodotto per la ricerca interna del
 * marketplace (e per i motori). Restituisce un patch {name?, tags?} applicato
 * allo stato del form (human-in-the-loop). Modello veloce: è un compito di
 * riscrittura mirata, non serve Sonnet.
 */

export const runtime = 'nodejs';

const SYSTEM = `Sei un esperto SEO per il marketplace locale "MyCity Piacenza". Ottimizzi il TITOLO e i TAG di un prodotto perché venga trovato facilmente, restando naturale e onesto. Lavori in italiano.

Regole:
- "name": titolo chiaro e cercabile (marca + tipo prodotto + dettaglio distintivo, es. taglia/colore/materiale). 3-70 caratteri. Niente MAIUSCOLE urlate, niente keyword stuffing, niente simboli/emoji, niente ripetizioni.
- "tags": 5-8 parole chiave minuscole con cui un cliente cercherebbe il prodotto (tipo oggetto, sinonimi, materiale, occasione d'uso, stanza/contesto). La prima è il tipo di oggetto. Lista COMPLETA desiderata. Niente duplicati del titolo parola per parola.
- Non inventare caratteristiche non presenti nella scheda o nelle foto.
- Tocca SOLO name e tags. Rispondi sempre e solo chiamando lo strumento "seo_optimize".`;

const SEO_TOOL: Anthropic.Tool = {
  name: 'seo_optimize',
  description: 'Propone titolo e tag ottimizzati per la ricerca.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'Breve nota in italiano su cosa hai migliorato.' },
      patch: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Lista completa desiderata.' },
        },
      },
    },
    required: ['patch'],
  },
};

type SeoInput = { reply?: string; patch?: { name?: string; tags?: string[] } };
type Body = ProductContextInput;

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');
  const rl = rateLimit({ key: `ai-seo:${user.id}`, max: 30, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }
  if (!body?.product || typeof body.product !== 'object') {
    return ApiErrors.invalidRequest('Manca la scheda del prodotto.');
  }

  const content = buildProductContext(body, {
    lead: 'Ottimizza titolo e tag di questo prodotto per la ricerca.',
  });

  try {
    const { toolInput } = await runMessage<SeoInput>({
      feature: 'ai-seo',
      model: MODELS.fast,
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      tools: [SEO_TOOL],
      tool_choice: { type: 'tool', name: 'seo_optimize' },
    });

    const patch: { name?: string; tags?: string[] } = {};
    if (typeof toolInput?.patch?.name === 'string' && toolInput.patch.name.trim()) {
      patch.name = toolInput.patch.name.trim();
    }
    if (Array.isArray(toolInput?.patch?.tags)) {
      const tags: string[] = [];
      for (const raw of toolInput!.patch!.tags!) {
        const t = String(raw).trim().toLowerCase().replace(/,+$/, '');
        if (t && t.length <= 30 && !tags.includes(t) && tags.length < 15) tags.push(t);
      }
      if (tags.length) patch.tags = tags;
    }

    return NextResponse.json({
      reply: typeof toolInput?.reply === 'string' ? toolInput.reply : '',
      patch,
    });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-seo');
    return ApiErrors.internal('Errore AI.');
  }
});

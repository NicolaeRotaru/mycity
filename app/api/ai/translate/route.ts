import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';
import { buildProductContext, type ProductContextInput } from '@/lib/ai/productContext';

/**
 * Traduzione annuncio: traduce nome, descrizione e tag di un prodotto in una
 * lingua target, per raggiungere acquirenti non italiani. Restituisce un patch
 * {name, description, tags?} applicato allo stato del form (human-in-the-loop).
 */

export const runtime = 'nodejs';

/** Lingue supportate (codice → nome per il prompt). */
const LANGS: Record<string, string> = {
  en: 'inglese',
  fr: 'francese',
  de: 'tedesco',
  es: 'spagnolo',
  ro: 'rumeno',
  ar: 'arabo',
  zh: 'cinese',
  it: 'italiano',
};

const TRANSLATE_TOOL: Anthropic.Tool = {
  name: 'translate_product',
  description: 'Restituisce nome, descrizione e tag tradotti nella lingua richiesta.',
  input_schema: {
    type: 'object',
    properties: {
      patch: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'description'],
      },
    },
    required: ['patch'],
  },
};

type TranslateInput = { patch?: { name?: string; description?: string; tags?: string[] } };
type Body = ProductContextInput & { targetLang?: string };

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');
  const rl = await rateLimitAsync({ key: `ai-translate:${user.id}`, max: 40, windowMs: 60 * 60_000 });
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
  const langCode = typeof body.targetLang === 'string' ? body.targetLang.toLowerCase() : '';
  const langName = LANGS[langCode];
  if (!langName) return ApiErrors.invalidRequest('Lingua di destinazione non supportata.');

  const system = `Sei un traduttore professionista per il marketplace "MyCity Piacenza". Traduci il contenuto di un annuncio prodotto in ${langName}, in modo naturale e fedele, mantenendo il significato e il tono commerciale. Non aggiungere né togliere informazioni, non inventare. Mantieni numeri, unità e nomi propri/marche invariati dove ha senso. I tag devono essere parole chiave nella lingua di destinazione (minuscole). Rispondi sempre e solo chiamando lo strumento "translate_product".`;

  const content = buildProductContext(body, {
    lead: `Traduci questo annuncio in ${langName}.`,
  });

  try {
    const { toolInput } = await runMessage<TranslateInput>({
      feature: 'ai-translate',
      model: MODELS.fast,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content }],
      tools: [TRANSLATE_TOOL],
      tool_choice: { type: 'tool', name: 'translate_product' },
    });

    const name = typeof toolInput?.patch?.name === 'string' ? toolInput.patch.name.trim() : '';
    const description =
      typeof toolInput?.patch?.description === 'string' ? toolInput.patch.description.trim() : '';
    if (!name && !description) {
      return ApiErrors.badGateway('Traduzione non riuscita. Riprova.');
    }

    const patch: { name?: string; description?: string; tags?: string[] } = {};
    if (name) patch.name = name;
    if (description) patch.description = description;
    if (Array.isArray(toolInput?.patch?.tags)) {
      const tags: string[] = [];
      for (const raw of toolInput!.patch!.tags!) {
        const t = String(raw).trim().toLowerCase().replace(/,+$/, '');
        if (t && t.length <= 30 && !tags.includes(t) && tags.length < 15) tags.push(t);
      }
      if (tags.length) patch.tags = tags;
    }

    return NextResponse.json({ patch, lang: langCode });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-translate');
    return ApiErrors.internal('Errore AI.');
  }
});

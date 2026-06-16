import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';
import { PRODUCT_PATCH_PROPERTIES } from '@/lib/ai/patchSchema';

/**
 * Lookup prodotto da codice a barre (EAN/UPC): identifica il prodotto online a
 * partire dal codice e restituisce un patch per precompilare la scheda. Si
 * innesca dopo la scansione EAN nel form. Non scrive nel DB: l'UI applica il
 * patch allo stato del form (human-in-the-loop). Usa web_search per identificare
 * il prodotto reale dietro il codice.
 */

export const runtime = 'nodejs';

const SYSTEM = `Sei un assistente del marketplace "MyCity Piacenza". Ricevi un codice a barre (EAN/UPC) e devi IDENTIFICARE il prodotto corrispondente usando lo strumento web_search, poi compilare la scheda. Lavori in italiano.

- Cerca online il codice esatto per capire di che prodotto si tratta (marca, modello, descrizione, prezzo tipico). Se non trovi nulla di affidabile, imposta found=false e non inventare.
- Compila "patch" con i campi ricavati: name (chiaro e specifico), description (1-3 frasi, onesta), category_slug (uno tra quelli forniti, in base alla funzione del prodotto), subcategory_name se sensata, price (prezzo di mercato italiano), attributes (SOLO le chiavi valide per la categoria scelta; per i campi a scelta usa esattamente uno dei valori ammessi; includi l'EAN), tags (3-8 parole chiave minuscole).
- Niente emoji. Prezzi in euro come numero.
Rispondi sempre e solo chiamando lo strumento "barcode_fill".`;

const TOOL: Anthropic.Tool = {
  name: 'barcode_fill',
  description: 'Identifica il prodotto dal codice a barre e compila la scheda.',
  input_schema: {
    type: 'object',
    properties: {
      found: { type: 'boolean', description: 'true se hai identificato il prodotto con ragionevole certezza.' },
      reply: { type: 'string', description: 'Breve nota in italiano (es. cosa hai trovato).' },
      patch: {
        type: 'object',
        description: 'Campi ricavati dal codice. Ometti se found=false.',
        properties: PRODUCT_PATCH_PROPERTIES,
      },
    },
    required: ['found'],
  },
};

const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 4,
  user_location: { type: 'approximate', country: 'IT' },
};

type LookupInput = { found?: boolean; reply?: string; patch?: Record<string, unknown> };
type Body = {
  ean?: string;
  attributeSchema?: { key: string; label?: string; type?: string; options?: string[] }[];
  topCategories?: { name: string; slug: string }[];
};

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');
  const rl = rateLimit({ key: `ai-barcode:${user.id}`, max: 20, windowMs: 10 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }
  const ean = typeof body.ean === 'string' ? body.ean.replace(/\D/g, '') : '';
  if (ean.length < 8 || ean.length > 14) {
    return ApiErrors.invalidRequest('Codice EAN/UPC non valido.');
  }

  const attributeSchema = Array.isArray(body.attributeSchema) ? body.attributeSchema : [];
  const topCategories = Array.isArray(body.topCategories) ? body.topCategories : [];
  const attrLines = attributeSchema
    .map((f) => {
      const opts = f.options && f.options.length ? ` [opzioni: ${f.options.join(', ')}]` : '';
      return `- ${f.key} (${f.type ?? 'text'})${opts}`;
    })
    .join('\n');

  const userText = `Codice a barre da identificare: ${ean}

Categorie di primo livello disponibili (slug):
${topCategories.map((c) => `- ${c.slug} (${c.name})`).join('\n') || '- (nessuna)'}

Attributi validi per la categoria attuale (se già scelta):
${attrLines || '- (compila in base alla categoria che sceglierai)'}

Identifica il prodotto dietro questo codice e compila la scheda.`;

  try {
    const { toolInput } = await runMessage<LookupInput>({
      feature: 'ai-barcode-lookup',
      model: MODELS.smart,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: userText }],
      tools: [WEB_SEARCH_TOOL, TOOL],
      tool_choice: { type: 'auto' },
    });

    const found = toolInput?.found === true;
    const patch = found && toolInput?.patch && typeof toolInput.patch === 'object' ? toolInput.patch : {};
    // Garantiamo l'EAN tra gli attributi anche se il modello non lo rimette.
    if (found) {
      const attrs = (patch.attributes && typeof patch.attributes === 'object' ? patch.attributes : {}) as Record<string, string>;
      if (!attrs.ean) attrs.ean = ean;
      patch.attributes = attrs;
    }

    return NextResponse.json({
      found,
      reply: typeof toolInput?.reply === 'string' ? toolInput.reply : '',
      patch,
    });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-barcode-lookup');
    return ApiErrors.internal('Errore AI.');
  }
});

import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';
import { buildProductContext, type ProductContextInput } from '@/lib/ai/productContext';
import { PRODUCT_PATCH_PROPERTIES } from '@/lib/ai/patchSchema';
import { sellerEconomics } from '@/lib/products/economics';

/**
 * "Perché non vende?" — diagnostica un prodotto fermo e propone correzioni
 * concrete. L'AI guarda foto, scheda ed economia del prezzo, cerca online un
 * prezzo di mercato e restituisce: una lista di problemi per area (foto, prezzo,
 * titolo, descrizione, attributi, categoria) con gravità e fix, più un patch
 * opzionale già applicabile. Non scrive nel DB.
 */

export const runtime = 'nodejs';

const SYSTEM = `Sei un consulente di vendita per il marketplace locale "MyCity Piacenza". Un venditore ha un prodotto che non vende: capisci PERCHÉ e digli come rimediare, in modo concreto e onesto. Lavori in italiano.

Analizza per aree: foto (quantità/qualità/sfondo), prezzo (vs mercato locale e margine), titolo (chiarezza/cercabilità), descrizione (completezza/fiducia), attributi (campi mancanti utili), categoria (corretta?), disponibilità.
- Per ogni problema reale crea un "issue" con: area, severity ("alta"|"media"|"bassa"), e "fix" (cosa fare, una frase concreta).
- Non inventare problemi se la scheda è già buona: restituisci pochi issue ma veri.
- Hai l'economia del prezzo (commissione) e lo strumento web_search per confrontare i prezzi: usalo con parsimonia.
- Quando puoi MIGLIORARE direttamente dei campi (titolo, descrizione, prezzo, tag, attributi, categoria), includi un "patch" con SOLO i campi da cambiare (le foto NON sono nel patch: se mancano, mettilo tra gli issue).
- Dai uno "score" 0-100 di "vendibilità" attuale.

Rispondi sempre e solo chiamando lo strumento "diagnose".`;

const DIAGNOSE_TOOL: Anthropic.Tool = {
  name: 'diagnose',
  description: 'Diagnostica perché il prodotto non vende e propone correzioni.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Diagnosi in 1-2 frasi.' },
      score: { type: 'number', description: 'Vendibilità attuale 0-100.' },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            area: {
              type: 'string',
              enum: ['foto', 'prezzo', 'titolo', 'descrizione', 'attributi', 'categoria', 'disponibilità'],
            },
            severity: { type: 'string', enum: ['alta', 'media', 'bassa'] },
            fix: { type: 'string', description: 'Cosa fare, concreto.' },
          },
          required: ['area', 'severity', 'fix'],
        },
      },
      patch: {
        type: 'object',
        description: 'Correzioni applicabili. Solo i campi da cambiare. Ometti se non serve.',
        properties: PRODUCT_PATCH_PROPERTIES,
      },
    },
    required: ['summary', 'issues'],
  },
};

const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 3,
  user_location: { type: 'approximate', country: 'IT' },
};

type Issue = { area?: string; severity?: string; fix?: string };
type DiagnoseInput = {
  summary?: string;
  score?: number;
  issues?: Issue[];
  patch?: Record<string, unknown>;
};
type Body = ProductContextInput;

function clampScore(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');
  const rl = await rateLimitAsync({ key: `ai-diagnose:${user.id}`, max: 20, windowMs: 60 * 60_000 });
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

  const price = typeof body.product.price === 'number' ? body.product.price : null;
  const econ = sellerEconomics(price);
  const lead = `Capisci perché questo prodotto non vende e proponi correzioni. ${
    price
      ? `Sul prezzo attuale di €${econ.price.toFixed(2)} il venditore incassa circa €${econ.netToSeller.toFixed(2)} dopo la commissione del ${(econ.feeRate * 100).toFixed(0)}%.`
      : 'Prezzo non impostato.'
  }`;
  const content = buildProductContext(body, { lead });

  try {
    const { toolInput } = await runMessage<DiagnoseInput>({
      feature: 'ai-diagnose',
      model: MODELS.smart,
      max_tokens: 1536,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      tools: [WEB_SEARCH_TOOL, DIAGNOSE_TOOL],
      tool_choice: { type: 'auto' },
    });

    if (!toolInput) return ApiErrors.badGateway('L\'AI non ha prodotto una diagnosi. Riprova.');

    const issues = Array.isArray(toolInput.issues)
      ? toolInput.issues
          .filter((i): i is Issue => !!i && typeof i.area === 'string' && typeof i.fix === 'string')
          .map((i) => ({
            area: i.area as string,
            severity: ['alta', 'media', 'bassa'].includes(String(i.severity)) ? i.severity : 'media',
            fix: i.fix as string,
          }))
      : [];

    return NextResponse.json({
      summary: typeof toolInput.summary === 'string' ? toolInput.summary : '',
      score: clampScore(toolInput.score),
      issues,
      patch: toolInput.patch && typeof toolInput.patch === 'object' ? toolInput.patch : {},
    });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-diagnose');
    return ApiErrors.internal('Errore AI.');
  }
});

import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';

/**
 * Riepilogo recensioni: sintetizza i feedback degli acquirenti (di un prodotto
 * o del negozio) in pro, contro e azioni concrete per il venditore. Le
 * recensioni arrivano come DATO dal client (che le ha già caricate); nessuna
 * scrittura. Modello veloce: è sintesi, non ragionamento complesso.
 */

export const runtime = 'nodejs';

const MAX_REVIEWS = 100;
const MAX_LEN = 1000;

const SYSTEM = `Sei un analista per il marketplace "MyCity Piacenza". Ricevi le recensioni dei clienti e ne ricavi una sintesi utile al venditore, onesta e azionabile. Lavori in italiano.
- "summary": 1-2 frasi sul sentiment generale.
- "pros": punti di forza ricorrenti (3-6, brevi).
- "cons": criticità ricorrenti (0-6, brevi); ometti se non ce ne sono.
- "suggestions": 2-5 azioni concrete per migliorare prodotto/servizio in base ai feedback.
Non inventare: basati solo sulle recensioni fornite. Se sono poche, dillo. Rispondi sempre e solo chiamando lo strumento "summarize_reviews".`;

const TOOL: Anthropic.Tool = {
  name: 'summarize_reviews',
  description: 'Sintetizza le recensioni in pro, contro e suggerimenti.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      pros: { type: 'array', items: { type: 'string' } },
      cons: { type: 'array', items: { type: 'string' } },
      suggestions: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary'],
  },
};

type ReviewIn = { rating?: number; text?: string };
type Body = { reviews?: ReviewIn[]; productName?: string };
type SummaryInput = { summary?: string; pros?: string[]; cons?: string[]; suggestions?: string[] };

function cleanList(v: unknown, max = 6): string[] {
  return (Array.isArray(v) ? v : [])
    .filter((s): s is string => typeof s === 'string' && !!s.trim())
    .map((s) => s.trim())
    .slice(0, max);
}

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');
  const rl = await rateLimitAsync({ key: `ai-reviews:${user.id}`, max: 20, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }

  const reviews = (Array.isArray(body.reviews) ? body.reviews : [])
    .filter((r): r is ReviewIn => !!r && typeof r.text === 'string' && !!r.text.trim())
    .slice(0, MAX_REVIEWS)
    .map((r) => {
      const stars = typeof r.rating === 'number' ? ` (${Math.max(1, Math.min(5, Math.round(r.rating)))}/5)` : '';
      return `- ${r.text!.trim().slice(0, MAX_LEN)}${stars}`;
    });

  if (reviews.length === 0) {
    return ApiErrors.invalidRequest('Nessuna recensione da analizzare.');
  }

  const productLine = body.productName ? `Prodotto: ${String(body.productName).slice(0, 120)}\n\n` : '';
  const dataText = `${productLine}Recensioni dei clienti (${reviews.length}):\n${reviews.join('\n')}`;

  try {
    const { toolInput } = await runMessage<SummaryInput>({
      feature: 'ai-reviews-summary',
      model: MODELS.fast,
      max_tokens: 768,
      system: SYSTEM,
      messages: [{ role: 'user', content: dataText }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'summarize_reviews' },
    });

    if (!toolInput) return ApiErrors.badGateway('Sintesi non riuscita. Riprova.');

    return NextResponse.json({
      summary: typeof toolInput.summary === 'string' ? toolInput.summary : '',
      pros: cleanList(toolInput.pros),
      cons: cleanList(toolInput.cons),
      suggestions: cleanList(toolInput.suggestions, 5),
      count: reviews.length,
    });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-reviews-summary');
    return ApiErrors.internal('Errore AI.');
  }
});

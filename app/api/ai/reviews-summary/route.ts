import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';
import { recinta, REGOLA_TESTO_DI_TERZI } from '@/lib/ai/recinto';
import { getAdminSupabase } from '@/lib/supabase/server';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

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
Non inventare: basati solo sulle recensioni fornite. Se sono poche, dillo. Rispondi sempre e solo chiamando lo strumento "summarize_reviews".
${REGOLA_TESTO_DI_TERZI}`;

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

type Body = { productId?: string };
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
    body = await jsonRichiesta(req, TETTO_JSON);
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }

  // #202 — Le recensioni non arrivano piu' dal client. Prima l'endpoint
  // sintetizzava qualunque testo gli venisse passato: un venditore poteva
  // farsi analizzare le recensioni di un concorrente, o del testo inventato, e
  // ogni chiamata la pagavamo noi. Ora si dichiara QUALE prodotto, si verifica
  // che sia suo, e le recensioni si leggono dal database.
  const productId = typeof body.productId === 'string' ? body.productId : '';
  if (!/^[0-9a-f-]{36}$/i.test(productId)) {
    return ApiErrors.invalidRequest('Manca il prodotto di cui riassumere le recensioni.');
  }

  const admin = getAdminSupabase();
  const { data: prodotto } = await admin
    .from('products')
    .select('id, name, seller_id')
    .eq('id', productId)
    .single();
  if (!prodotto) return ApiErrors.notFound('Prodotto non trovato.');
  if (prodotto.seller_id !== user.id) return ApiErrors.forbidden('Questo prodotto non e\' tuo.');

  const { data: righe } = await admin
    .from('reviews')
    .select('rating, comment')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(MAX_REVIEWS);

  // #200 — Ogni recensione dentro il suo recinto: e' testo scritto da terzi.
  const reviews = ((righe ?? []) as Array<{ rating: number | null; comment: string | null }>)
    .filter((r) => typeof r.comment === 'string' && r.comment.trim().length > 0)
    .map((r) => {
      const stelle = typeof r.rating === 'number' ? ` (${Math.max(1, Math.min(5, Math.round(r.rating)))}/5)` : '';
      return `${recinta('recensione', r.comment ?? '', MAX_LEN)}${stelle}`;
    });

  if (reviews.length === 0) {
    return ApiErrors.invalidRequest('Nessuna recensione da analizzare.');
  }

  const productLine = `Prodotto: ${String(prodotto.name ?? '').slice(0, 120)}\n\n`;
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

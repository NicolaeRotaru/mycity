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
 * Risposta assistita alle domande: dato un prodotto e la domanda di un
 * acquirente, propone al venditore una BOZZA di risposta cortese e fedele alla
 * scheda. Se la risposta non è ricavabile dai dati, lo segnala (needs_seller_input)
 * invece di inventare. Il venditore rivede e invia: niente invio automatico.
 */

export const runtime = 'nodejs';

const SYSTEM = `Sei l'assistente di un venditore sul marketplace "MyCity Piacenza". Un acquirente ha fatto una domanda su un prodotto: prepara per il venditore una BOZZA di risposta in italiano, cortese, chiara e onesta, basata SOLO sulla scheda prodotto e sulle foto.
- Se la risposta è ricavabile dai dati, scrivila in modo diretto e gentile (1-4 frasi).
- Se l'informazione NON è nella scheda (es. una misura non indicata), NON inventarla: imposta needs_seller_input=true e nella "answer" proponi una risposta che invita a verificare, lasciando al venditore il dato da confermare.
- Niente promesse non sostenibili, niente dati inventati, niente emoji eccessive.
Rispondi sempre e solo chiamando lo strumento "draft_answer".`;

const TOOL: Anthropic.Tool = {
  name: 'draft_answer',
  description: 'Propone una bozza di risposta alla domanda dell\'acquirente.',
  input_schema: {
    type: 'object',
    properties: {
      answer: { type: 'string', description: 'Bozza di risposta in italiano.' },
      needs_seller_input: {
        type: 'boolean',
        description: 'true se la risposta richiede un dato che il venditore deve confermare.',
      },
    },
    required: ['answer'],
  },
};

type AnswerInput = { answer?: string; needs_seller_input?: boolean };
type Body = ProductContextInput & { question?: string };

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');
  const rl = await rateLimitAsync({ key: `ai-answer-qa:${user.id}`, max: 40, windowMs: 60 * 60_000 });
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
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 1000) : '';
  if (!question) return ApiErrors.invalidRequest('Manca la domanda dell\'acquirente.');

  const content = buildProductContext(body, {
    lead: `Domanda dell'acquirente: "${question}"\n\nPrepara una bozza di risposta.`,
  });

  try {
    const { toolInput } = await runMessage<AnswerInput>({
      feature: 'ai-answer-qa',
      model: MODELS.fast,
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'draft_answer' },
    });

    const answer = typeof toolInput?.answer === 'string' ? toolInput.answer.trim() : '';
    if (!answer) return ApiErrors.badGateway('Bozza non riuscita. Riprova.');

    return NextResponse.json({
      answer,
      needsSellerInput: toolInput?.needs_seller_input === true,
    });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-answer-qa');
    return ApiErrors.internal('Errore AI.');
  }
});

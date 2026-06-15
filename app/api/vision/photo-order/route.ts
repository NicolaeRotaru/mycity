import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';
import { sanitizeImageUrls } from '@/lib/ai/productContext';

/**
 * Ordine e copertina foto: il modello valuta le foto del prodotto e propone la
 * sequenza migliore (copertina per prima) + note per foto. L'UI riordina le
 * immagini del form. Non scrive nel DB. La copertina è la leva n.1 sul tasso di
 * clic: vale una passata vision dedicata.
 */

export const runtime = 'nodejs';

const SYSTEM = `Sei un esperto di fotografia prodotto per e-commerce. Ti vengono date le foto NUMERATE (0..N-1) di un singolo prodotto. Proponi l'ordine MIGLIORE per vendere, con la foto di COPERTINA per prima. Lavori in italiano.

Criteri per la copertina: prodotto intero ben visibile e centrato, sfondo pulito, luce buona, nitida. Penalizza foto sfocate, scure, con sfondo disordinato, dettagli parziali o testo/etichetta come prima foto.
- "order": permutazione completa degli indici forniti, dalla migliore (copertina) alla peggiore.
- "cover": l'indice della foto di copertina (il primo di order).
- "notes": per gli indici con problemi, una nota brevissima (es. "sfocata", "sfondo disordinato", "mostra solo l'etichetta").
- "tips": 1-3 consigli concreti per migliorare il set di foto (opzionale).
Rispondi sempre e solo chiamando lo strumento "order_photos".`;

const TOOL: Anthropic.Tool = {
  name: 'order_photos',
  description: 'Propone l\'ordine delle foto e la copertina.',
  input_schema: {
    type: 'object',
    properties: {
      order: { type: 'array', items: { type: 'number' }, description: 'Permutazione degli indici, copertina per prima.' },
      cover: { type: 'number', description: 'Indice della foto di copertina.' },
      notes: {
        type: 'array',
        items: {
          type: 'object',
          properties: { index: { type: 'number' }, note: { type: 'string' } },
          required: ['index', 'note'],
        },
      },
      tips: { type: 'array', items: { type: 'string' } },
    },
    required: ['order'],
  },
};

type OrderInput = {
  order?: number[];
  cover?: number;
  notes?: { index?: number; note?: string }[];
  tips?: string[];
};
type Body = { imageUrls?: string[] };

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');
  const rl = rateLimit({ key: `vision-order:${user.id}`, max: 15, windowMs: 10 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }
  const imageUrls = sanitizeImageUrls(body.imageUrls, 8);
  if (imageUrls.length < 2) {
    return ApiErrors.invalidRequest('Servono almeno 2 foto da ordinare.');
  }

  const content: Anthropic.ContentBlockParam[] = [];
  imageUrls.forEach((url, i) => {
    content.push({ type: 'text', text: `Foto ${i}:` });
    content.push({ type: 'image', source: { type: 'url', url } });
  });
  content.push({ type: 'text', text: 'Proponi ordine e copertina chiamando order_photos.' });

  try {
    const { toolInput } = await runMessage<OrderInput>({
      feature: 'vision-photo-order',
      model: MODELS.vision,
      max_tokens: 768,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'order_photos' },
    });

    if (!toolInput) return ApiErrors.badGateway('Analisi non riuscita. Riprova.');

    // order = permutazione valida e COMPLETA: indici validi unici, poi
    // appendiamo gli eventuali mancanti nell'ordine originale.
    const seen = new Set<number>();
    const order: number[] = [];
    for (const n of Array.isArray(toolInput.order) ? toolInput.order : []) {
      if (Number.isInteger(n) && n >= 0 && n < imageUrls.length && !seen.has(n)) {
        seen.add(n);
        order.push(n);
      }
    }
    for (let i = 0; i < imageUrls.length; i++) if (!seen.has(i)) order.push(i);

    const notes = (Array.isArray(toolInput.notes) ? toolInput.notes : [])
      .filter((n): n is { index: number; note: string } =>
        !!n && Number.isInteger(n.index) && n.index! >= 0 && n.index! < imageUrls.length && typeof n.note === 'string')
      .map((n) => ({ index: n.index, note: n.note.trim() }));

    const tips = (Array.isArray(toolInput.tips) ? toolInput.tips : [])
      .filter((t): t is string => typeof t === 'string' && !!t.trim())
      .map((t) => t.trim())
      .slice(0, 3);

    return NextResponse.json({ order, cover: order[0], notes, tips });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'vision-photo-order');
    return ApiErrors.internal('Errore AI.');
  }
});

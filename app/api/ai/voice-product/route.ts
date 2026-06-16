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
 * Voce → prodotto: il venditore detta a parole un prodotto ("ho tre magliette
 * rosse di cotone a 15 euro l'una") e l'AI trasforma il testo in una scheda
 * (patch). Il transcript arriva dal client (Web Speech API). Non scrive nel DB:
 * l'UI applica il patch allo stato del form (human-in-the-loop). Modello veloce:
 * è parsing strutturato, non serve ricerca.
 */

export const runtime = 'nodejs';

const SYSTEM = `Sei l'assistente del marketplace "MyCity Piacenza". Il venditore DESCRIVE a voce un prodotto e tu trasformi il suo testo in una scheda prodotto, compilando un patch. Lavori in italiano.

- Ricava dai suoi dati: name (chiaro e specifico), description (1-3 frasi, onesta, basata su ciò che ha detto), price (in euro, se indicato — "15 euro l'una" → 15), stock (quantità se indicata — "tre magliette" → 3), category_slug (uno tra quelli forniti, in base al tipo di oggetto), subcategory_name se sensata, condition (nuovo/usato/ricondizionato se indicato), unit, attributes (SOLO chiavi valide per la categoria; per i campi a scelta usa esattamente uno dei valori ammessi — es. colore, taglia, materiale), tags (3-8 parole chiave minuscole).
- NON inventare ciò che non è stato detto né chiaramente deducibile. Ometti i campi incerti.
- Niente emoji. Prezzi in euro come numero.
Rispondi sempre e solo chiamando lo strumento "voice_fill".`;

const TOOL: Anthropic.Tool = {
  name: 'voice_fill',
  description: 'Trasforma la descrizione vocale del venditore in una scheda prodotto.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'Breve conferma in italiano di cosa hai capito.' },
      patch: {
        type: 'object',
        description: 'Campi ricavati dalla voce. Ometti gli incerti.',
        properties: PRODUCT_PATCH_PROPERTIES,
      },
    },
    required: ['patch'],
  },
};

type VoiceInput = { reply?: string; patch?: Record<string, unknown> };
type Body = {
  transcript?: string;
  attributeSchema?: { key: string; label?: string; type?: string; options?: string[] }[];
  topCategories?: { name: string; slug: string }[];
};

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');
  const rl = rateLimit({ key: `ai-voice:${user.id}`, max: 40, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim().slice(0, 2000) : '';
  if (transcript.length < 3) return ApiErrors.invalidRequest('Dimmi qualcosa sul prodotto.');

  const attributeSchema = Array.isArray(body.attributeSchema) ? body.attributeSchema : [];
  const topCategories = Array.isArray(body.topCategories) ? body.topCategories : [];
  const attrLines = attributeSchema
    .map((f) => {
      const opts = f.options && f.options.length ? ` [opzioni: ${f.options.join(', ')}]` : '';
      return `- ${f.key} (${f.type ?? 'text'})${opts}`;
    })
    .join('\n');

  const userText = `Il venditore ha detto:
"${transcript}"

Categorie di primo livello disponibili (slug):
${topCategories.map((c) => `- ${c.slug} (${c.name})`).join('\n') || '- (nessuna)'}

Attributi validi per la categoria attuale (se già scelta):
${attrLines || '- (compila in base alla categoria che sceglierai)'}

Trasforma la descrizione in una scheda prodotto.`;

  try {
    const { toolInput } = await runMessage<VoiceInput>({
      feature: 'ai-voice-product',
      model: MODELS.fast,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: userText }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'voice_fill' },
    });

    const patch = toolInput?.patch && typeof toolInput.patch === 'object' ? toolInput.patch : {};
    return NextResponse.json({
      reply: typeof toolInput?.reply === 'string' ? toolInput.reply : '',
      patch,
    });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-voice-product');
    return ApiErrors.internal('Errore AI.');
  }
});

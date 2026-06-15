import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';
import { buildProductContext } from '@/lib/ai/productContext';

/**
 * Generazione varianti: propone gli assi di variante (es. Taglia, Colore) con i
 * relativi valori a partire dalla scheda e dalle foto, usando SOLO i campi
 * "variantable" della categoria. L'UI li applica al sistema varianti del form
 * (assi → combinazioni), che resta human-in-the-loop. Non scrive nel DB.
 */

export const runtime = 'nodejs';

const SYSTEM = `Sei l'assistente del marketplace "MyCity Piacenza". Proponi gli ASSI DI VARIANTE sensati per un prodotto (es. Taglia, Colore, Formato) con i loro valori, così il venditore può vendere più versioni dello stesso articolo. Lavori in italiano.

Regole:
- Usa SOLO le chiavi tra i "campi variante disponibili" forniti. Non inventare assi non presenti.
- Per i campi a scelta (con opzioni elencate) usa ESCLUSIVAMENTE quelle opzioni.
- Per i campi liberi (es. colore) proponi valori realistici e specifici, dedotti da foto/scheda; pochi e sensati (2-6 per asse), niente liste enormi.
- Proponi un asse SOLO se ha davvero senso avere più versioni per questo prodotto. Se non serve nessuna variante, restituisci "axes" vuoto.
- Niente duplicati.
Rispondi sempre e solo chiamando lo strumento "suggest_variants".`;

const TOOL: Anthropic.Tool = {
  name: 'suggest_variants',
  description: 'Propone assi di variante con i relativi valori.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'Breve nota in italiano sugli assi proposti.' },
      axes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Chiave del campo variante (tra quelli disponibili).' },
            values: { type: 'array', items: { type: 'string' }, description: '2-6 valori per l\'asse.' },
          },
          required: ['key', 'values'],
        },
      },
    },
    required: ['axes'],
  },
};

type VariantField = { key: string; label?: string; type?: string; options?: string[] };
type VariantsInput = { reply?: string; axes?: { key?: string; values?: string[] }[] };
type Body = {
  product?: Record<string, unknown>;
  variantableFields?: VariantField[];
  imageUrls?: string[];
};

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');
  const rl = rateLimit({ key: `ai-variants:${user.id}`, max: 20, windowMs: 60 * 60_000 });
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
  const fields = (Array.isArray(body.variantableFields) ? body.variantableFields : []).filter(
    (f): f is VariantField => !!f && typeof f.key === 'string',
  );
  if (fields.length === 0) {
    return ApiErrors.invalidRequest('Questa categoria non ha campi che diventano varianti.');
  }

  const fieldLines = fields
    .map((f) => {
      const opts = f.options && f.options.length ? ` [opzioni: ${f.options.join(', ')}]` : ' [valori liberi]';
      return `- ${f.key} (${f.label ?? f.key})${opts}`;
    })
    .join('\n');

  const content = buildProductContext(
    { product: body.product, imageUrls: body.imageUrls },
    { lead: `Proponi gli assi di variante per questo prodotto.\n\nCampi variante disponibili:\n${fieldLines}` },
  );

  try {
    const { toolInput } = await runMessage<VariantsInput>({
      feature: 'ai-variants',
      model: MODELS.smart,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'suggest_variants' },
    });

    // Normalizza: solo chiavi valide; per i select solo opzioni ammesse; dedup.
    const allowed = new Map(fields.map((f) => [f.key, f]));
    const axes = (Array.isArray(toolInput?.axes) ? toolInput!.axes! : [])
      .map((a) => {
        const field = a && typeof a.key === 'string' ? allowed.get(a.key) : undefined;
        if (!field) return null;
        const opts = field.type === 'select' && field.options ? field.options : null;
        const values: string[] = [];
        const seenLower = new Set<string>();
        for (const raw of Array.isArray(a!.values) ? a!.values! : []) {
          const v = typeof raw === 'string' ? raw.trim() : '';
          if (!v) continue;
          // Per i select il valore canonico viene dalle opzioni; per i campi
          // liberi si tiene la prima occorrenza. Dedup sempre case-insensitive.
          const canonical = opts ? opts.find((o) => o.toLowerCase() === v.toLowerCase()) : v;
          if (!canonical) continue;
          const lower = canonical.toLowerCase();
          if (!seenLower.has(lower) && values.length < 12) {
            seenLower.add(lower);
            values.push(canonical);
          }
        }
        return values.length ? { key: field.key, label: field.label ?? field.key, values } : null;
      })
      .filter((a): a is { key: string; label: string; values: string[] } => a !== null);

    return NextResponse.json({
      reply: typeof toolInput?.reply === 'string' ? toolInput.reply : '',
      axes,
    });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-variants');
    return ApiErrors.internal('Errore AI.');
  }
});

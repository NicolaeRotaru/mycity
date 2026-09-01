import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';
import { buildProductContext } from '@/lib/ai/productContext';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
// 27/8/2026 (R150) — La riga che dice al modello che la scheda e' un DATO e
// non un ordine. La chat prodotto, la chat catalogo, il codice a barre e il
// lavoro massivo ce l'hanno da agosto: qui mancava, e la descrizione importata
// da un altro marketplace la scrive un estraneo.
import { REGOLA_TESTO_DI_TERZI } from '@/lib/ai/recinto';
import { filtroSullaScheda } from '@/lib/ai/schedaSicura';

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
Rispondi sempre e solo chiamando lo strumento "suggest_variants".

${REGOLA_TESTO_DI_TERZI}`;

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
  const rl = await rateLimitAsync({ key: `ai-variants:${user.id}`, max: 20, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: Body;
  try {
    body = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    // (R153) Troppo grande e malformato non sono la stessa cosa: il perche' e'
    // scritto per esteso in app/api/ai/catalog-chat/route.ts.
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('JSON non valido');
  }
  if (!body?.product || typeof body.product !== 'object') {
    return ApiErrors.invalidRequest('Manca la scheda del prodotto.');
  }
  // 22/8/2026 — L'ELENCO DEI CAMPI ARRIVAVA DAL BROWSER SENZA NESSUN TETTO.
  //
  // `buildProductContext` taglia gli elenchi che compone lui — gli attributi
  // della categoria, le categorie di primo livello. Questo elenco pero' non
  // passa di li': arriva gia' composto come testo, dentro la riga di apertura,
  // e i tagli gli passano accanto. Chi manda la richiesta poteva metterci
  // dentro mille campi con mille opzioni ciascuno e spingere fuori dalla
  // finestra del modello tutto il resto della scheda.
  //
  // Venti campi variante e trenta opzioni per campo sono gia' piu' di quanti
  // ne abbia qualunque categoria vera: stesse cifre che usa buildProductContext
  // per gli elenchi equivalenti.
  const MAX_CAMPI = 20;
  const MAX_OPZIONI = 30;
  const fields = (Array.isArray(body.variantableFields) ? body.variantableFields : [])
    .filter((f): f is VariantField => !!f && typeof f.key === 'string')
    .slice(0, MAX_CAMPI);
  if (fields.length === 0) {
    return ApiErrors.invalidRequest('Questa categoria non ha campi che diventano varianti.');
  }

  // 27/8/2026 (R148) — La scheda passa dal filtro anti-contenuti-vietati come
  // il testo libero delle altre rotte. Perche' qui e non altrove:
  // lib/ai/schedaSicura.ts.
  const nonAmmessa = await filtroSullaScheda(body.product, 'ai-variants-policy');
  if (nonAmmessa) return nonAmmessa;

  const fieldLines = fields
    .map((f) => {
      const opzioni = (f.options ?? []).slice(0, MAX_OPZIONI);
      const opts = opzioni.length ? ` [opzioni: ${opzioni.join(', ')}]` : ' [valori liberi]';
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

import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';
import { sellerEconomics } from '@/lib/products/economics';

/**
 * Motore "Migliora tutto" — una singola passata AI che ottimizza l'INTERA
 * scheda di un prodotto in un colpo solo, invece di un campo alla volta.
 *
 * A differenza di /api/ai/product-chat (conversazione, un'intenzione per turno),
 * qui NON c'è chat: il venditore preme un bottone e l'assistente — guardando le
 * foto e cercando online — propone in una volta nome, descrizione, prezzo
 * (consapevole di commissione + fee), tag/SEO, attributi di categoria,
 * categoria, condizione e unità, insieme a un PUNTEGGIO QUALITÀ before→after e
 * al perché di ogni cambiamento. Non scrive nel DB: ritorna una proposta che la
 * UI applica allo stato del form (human-in-the-loop), poi il venditore salva.
 *
 * Esperti senior consultati:
 * - Prompt Engineer: "Foto + scheda + economia del prezzo sono DATO → messages.
 *   Il system (chi sei, come ottimizzi, come dai il punteggio) resta stabile e
 *   cacheabile. Output SOLO via tool: niente prosa libera da parsare."
 * - Merchandising/Growth: "Ottimizza per conversione e fiducia: titolo
 *   cercabile, descrizione onesta e scannerizzabile, attributi completi, prezzo
 *   allineato al mercato locale. Mai gonfiare specifiche non supportate dalle
 *   foto o dalla ricerca."
 * - Finance: "Il prezzo deve essere ragionato sul NETTO venditore dopo la
 *   commissione: passiamo l'aliquota come dato e chiediamo il net-to-seller."
 * - Security: "Solo seller approvati; nessun campo libero entra nel DB senza la
 *   validazione del form/apply. Sonnet + web search = rate limit aggressivo."
 */

export const runtime = 'nodejs';

const SYSTEM = `Sei l'assistente esperto di "MyCity Piacenza" (marketplace locale di negozi di quartiere). Il tuo compito è MIGLIORARE in un'unica passata l'intera scheda di un prodotto di un venditore, così che venda di più e ispiri fiducia, restando SEMPRE onesto. Lavori in italiano.

Sei insieme: copywriter, merchandiser e analista di prezzo. Hai a disposizione:
- le foto reali del prodotto (quando presenti): guardale per capire di che oggetto si tratta davvero;
- lo stato attuale della scheda (JSON), gli slug delle categorie disponibili e gli attributi validi per la categoria;
- l'economia del prezzo: l'aliquota di commissione del marketplace e la fee di consegna, per ragionare sul NETTO che incassa il venditore;
- lo strumento "web_search" per identificare il prodotto reale, trovare specifiche tipiche e un prezzo di mercato equo. Spesso il compilatore automatico sbaglia prodotto (stesso nome, marca diversa): incrocia foto + ricerca.

Cosa ottimizzi (TUTTO insieme, solo dove migliora davvero):
- "name": chiaro, specifico e cercabile (marca + tipo + dettaglio distintivo). Niente MAIUSCOLE urlate, niente keyword stuffing, niente emoji.
- "description": calda, onesta e scannerizzabile (cos'è, materiali/ingredienti, dimensioni/taglia, condizione, a chi serve, cosa lo rende speciale). 250-600 caratteri. Non inventare ciò che non vedi o non trovi.
- "price": allineato al mercato locale italiano. Ragiona sul netto venditore dopo la commissione e tienilo sano; se proponi un prezzo, spiega il perché nel "pricing".
- "compare_at_price": SOLO se esiste uno sconto reale (prezzo pieno > prezzo). Altrimenti null o ometti.
- "tags": 3-8 parole chiave minuscole utili alla ricerca (sinonimi, occasioni d'uso). Lista COMPLETA desiderata.
- "attributes": COMPILA gli attributi mancanti che riesci a dedurre da foto/ricerca, usando SOLO le chiavi valide e, per i campi a scelta, SOLO le opzioni elencate.
- "category_slug"/"subcategory_name": correggi solo se quella attuale è sbagliata.
- "condition" e "unit": imposta se evidenti.

Punteggio qualità ("quality"):
- Dai un punteggio 0-100 PRIMA ("before") e DOPO ("after") le tue modifiche.
- Scomponi in "dimensions" con queste chiavi: foto, titolo, descrizione, prezzo, attributi, tag. Per ognuna: "score" (0-100), "max" (100) e una "note" brevissima in italiano.
- In "missing" elenca ciò che resta da migliorare e che TU non puoi fare da solo (es. "aggiungi una foto del retro", "manca la taglia"): le foto NON le puoi cambiare, quindi se sono poche/scarse segnalalo qui.

Spiega ogni cambiamento in "field_notes" (campo → perché), con frasi brevi e concrete. Cita in una riga cosa hai scoperto online, se hai cercato.

Regole per "patch" (le modifiche da applicare):
- Inserisci SOLO i campi che cambiano rispetto allo stato attuale; ometti gli invariati.
- Per TOGLIERE un valore: null per gli scalari (compare_at_price, condition) e "attributes_remove" per gli attributi.
- "tags" è la lista COMPLETA desiderata (ricostruiscila da quella attuale).
- Prezzi in euro come numero (es. 4.90). Niente emoji in nessun campo.

Rispondi SEMPRE e SOLO chiamando lo strumento "improve_product".`;

/** Schema del patch (campi modificabili) — gemello di edit_product/manage_product. */
const PATCH_PROPERTIES: Record<string, unknown> = {
  name: { type: 'string' },
  description: { type: 'string' },
  price: { type: 'number', description: 'Prezzo di vendita in euro.' },
  compare_at_price: {
    type: ['number', 'null'],
    description: 'Prezzo pieno barrato in euro. null per rimuoverlo.',
  },
  unit: { type: 'string', enum: ['pezzo', 'kg', 'g', 'l', 'ml', 'confezione', 'paio', 'm'] },
  condition: {
    type: ['string', 'null'],
    enum: ['nuovo', 'usato', 'ricondizionato', null],
    description: 'null per "non specificata".',
  },
  category_slug: { type: 'string', description: 'Slug della categoria di primo livello.' },
  subcategory_name: { type: 'string', description: 'Nome della sottocategoria (opzionale).' },
  tags: {
    type: 'array',
    items: { type: 'string' },
    description: 'Lista completa desiderata dei tag.',
  },
  attributes: {
    type: 'object',
    description: 'Attributi da impostare (chiave→valore).',
    additionalProperties: { type: 'string' },
  },
  attributes_remove: {
    type: 'array',
    items: { type: 'string' },
    description: 'Chiavi attributo da eliminare.',
  },
};

const IMPROVE_TOOL: Anthropic.Tool = {
  name: 'improve_product',
  description:
    'Restituisce la scheda prodotto ottimizzata: riepilogo, punteggio qualità before/after, ragionamento sul prezzo, note per campo e il patch dei campi da cambiare.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Riepilogo in 1-2 frasi di cosa hai migliorato e perché.',
      },
      quality: {
        type: 'object',
        properties: {
          before: { type: 'number', description: 'Punteggio qualità attuale 0-100.' },
          after: { type: 'number', description: 'Punteggio qualità dopo le modifiche 0-100.' },
          dimensions: {
            type: 'array',
            description: 'Scomposizione per dimensione.',
            items: {
              type: 'object',
              properties: {
                key: {
                  type: 'string',
                  enum: ['foto', 'titolo', 'descrizione', 'prezzo', 'attributi', 'tag'],
                },
                label: { type: 'string' },
                score: { type: 'number', description: '0-100' },
                max: { type: 'number', description: 'di norma 100' },
                note: { type: 'string', description: 'Nota brevissima in italiano.' },
              },
              required: ['key', 'score'],
            },
          },
          missing: {
            type: 'array',
            items: { type: 'string' },
            description: 'Cosa resta da migliorare e che richiede il venditore (es. foto).',
          },
        },
        required: ['before', 'after'],
      },
      pricing: {
        type: 'object',
        description: 'Ragionamento sul prezzo. Ometti se non tocchi il prezzo.',
        properties: {
          suggested: { type: ['number', 'null'], description: 'Prezzo consigliato in euro.' },
          net_to_seller: {
            type: ['number', 'null'],
            description: 'Netto stimato per il venditore dopo la commissione, in euro.',
          },
          rationale: { type: 'string', description: 'Perché questo prezzo (mercato, margine).' },
        },
      },
      field_notes: {
        type: 'array',
        description: 'Perché di ogni campo cambiato.',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['field', 'note'],
        },
      },
      patch: {
        type: 'object',
        description: 'Solo i campi da cambiare. Ometti quelli invariati.',
        properties: PATCH_PROPERTIES,
      },
    },
    required: ['summary', 'quality'],
  },
};

const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,
  user_location: { type: 'approximate', country: 'IT' },
};

type AttributeSchemaField = { key: string; label?: string; type?: string; options?: string[] };

type ImproveBody = {
  product?: Record<string, unknown>;
  attributeSchema?: AttributeSchemaField[];
  topCategories?: { name: string; slug: string }[];
  imageUrls?: string[];
};

type QualityDimension = {
  key: string;
  label?: string;
  score?: number;
  max?: number;
  note?: string;
};
type ImproveInput = {
  summary?: string;
  quality?: { before?: number; after?: number; dimensions?: QualityDimension[]; missing?: string[] };
  pricing?: { suggested?: number | null; net_to_seller?: number | null; rationale?: string };
  field_notes?: { field?: string; note?: string }[];
  patch?: Record<string, unknown>;
};

const MAX_IMAGES = 4;

/** Clamp di un punteggio in 0-100; undefined se non numerico. */
function clampScore(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');

  // Rate limit aggressivo: passata completa (Sonnet + web search) = costosa.
  const rl = await rateLimitAsync({ key: `ai-improve-product:${user.id}`, max: 20, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: ImproveBody;
  try {
    body = await req.json();
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }

  const product = body.product && typeof body.product === 'object' ? body.product : {};
  const attributeSchema = Array.isArray(body.attributeSchema) ? body.attributeSchema : [];
  const topCategories = Array.isArray(body.topCategories) ? body.topCategories : [];
  const imageUrls = (Array.isArray(body.imageUrls) ? body.imageUrls : [])
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, MAX_IMAGES);

  if (!product || Object.keys(product).length === 0) {
    return ApiErrors.invalidRequest('Manca la scheda del prodotto da migliorare.');
  }

  // Economia del prezzo come DATO: aliquota commissione + netto sul prezzo
  // attuale, così il modello ragiona sul margine reale del venditore.
  const currentPrice = typeof product.price === 'number' ? product.price : null;
  const econ = sellerEconomics(currentPrice);
  const feePct = (econ.feeRate * 100).toFixed(0);

  const attrLines = attributeSchema
    .map((f) => {
      const opts = f.options && f.options.length ? ` [opzioni: ${f.options.join(', ')}]` : '';
      return `- ${f.key} (${f.type ?? 'text'})${opts}`;
    })
    .join('\n');

  const contextText = `${imageUrls.length ? 'Le immagini qui sopra sono le foto reali di questo prodotto: usale per identificarlo e valutarne la qualità.\n\n' : 'Questo prodotto NON ha foto: segnalalo in quality.missing e nella dimensione "foto".\n\n'}Stato attuale del prodotto (JSON):
${JSON.stringify(product, null, 2)}

Categorie di primo livello disponibili (slug):
${topCategories.map((c) => `- ${c.slug} (${c.name})`).join('\n') || '- (nessuna)'}

Attributi validi per la categoria attuale:
${attrLines || '- (nessuno)'}

Economia del prezzo (per ragionare sul netto venditore):
- Commissione marketplace: ${feePct}% trattenuta da MyCity sull'incassato del venditore.
- Fee di consegna a domicilio: €${econ.deliveryFee.toFixed(2)} a carico dell'acquirente (non incide sul netto venditore).
${currentPrice ? `- Sul prezzo attuale di €${econ.price.toFixed(2)} il venditore incassa circa €${econ.netToSeller.toFixed(2)} (commissione €${econ.commission.toFixed(2)}).` : '- Prezzo attuale non impostato: proponilo tu in base al mercato.'}

Migliora la scheda e chiama "improve_product".`;

  const contextContent: Anthropic.ContentBlockParam[] = [
    ...imageUrls.map(
      (url): Anthropic.ImageBlockParam => ({ type: 'image', source: { type: 'url', url } }),
    ),
    { type: 'text', text: contextText },
  ];

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: contextContent }];

  try {
    const { toolInput } = await runMessage<ImproveInput>({
      feature: 'ai-improve-product',
      model: MODELS.smart,
      max_tokens: 3072,
      system: SYSTEM,
      messages,
      tools: [WEB_SEARCH_TOOL, IMPROVE_TOOL],
      tool_choice: { type: 'auto' },
    });

    if (!toolInput) {
      return ApiErrors.badGateway('L\'AI non ha prodotto un risultato. Riprova.');
    }

    const patch =
      toolInput.patch && typeof toolInput.patch === 'object' ? toolInput.patch : {};

    // Normalizza i punteggi (clamp 0-100) lato server: la UI si fida del range.
    const dims = Array.isArray(toolInput.quality?.dimensions)
      ? toolInput.quality!.dimensions!
          .filter((d): d is QualityDimension => !!d && typeof d.key === 'string')
          .map((d) => ({
            key: d.key,
            label: typeof d.label === 'string' ? d.label : d.key,
            score: clampScore(d.score) ?? 0,
            max: clampScore(d.max) ?? 100,
            note: typeof d.note === 'string' ? d.note : '',
          }))
      : [];

    const missing = Array.isArray(toolInput.quality?.missing)
      ? toolInput.quality!.missing!.filter((m): m is string => typeof m === 'string' && !!m.trim())
      : [];

    const fieldNotes = Array.isArray(toolInput.field_notes)
      ? toolInput.field_notes!
          .filter((n): n is { field: string; note: string } =>
            !!n && typeof n.field === 'string' && typeof n.note === 'string')
          .map((n) => ({ field: n.field, note: n.note }))
      : [];

    // Se il modello propone un prezzo, ricalcoliamo NOI il netto venditore:
    // unica fonte di verità, niente aritmetica allucinata.
    let pricing: { suggested: number | null; netToSeller: number | null; rationale: string } | null =
      null;
    const suggested =
      typeof toolInput.pricing?.suggested === 'number' && toolInput.pricing.suggested > 0
        ? toolInput.pricing.suggested
        : null;
    if (toolInput.pricing && (suggested != null || typeof toolInput.pricing.rationale === 'string')) {
      pricing = {
        suggested,
        netToSeller: suggested != null ? sellerEconomics(suggested).netToSeller : null,
        rationale:
          typeof toolInput.pricing.rationale === 'string' ? toolInput.pricing.rationale : '',
      };
    }

    return NextResponse.json({
      summary: typeof toolInput.summary === 'string' ? toolInput.summary : '',
      quality: {
        before: clampScore(toolInput.quality?.before) ?? 0,
        after: clampScore(toolInput.quality?.after) ?? 0,
        dimensions: dims,
        missing,
      },
      pricing,
      fieldNotes,
      patch,
    });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-improve-product');
    return ApiErrors.internal('Errore AI.');
  }
});

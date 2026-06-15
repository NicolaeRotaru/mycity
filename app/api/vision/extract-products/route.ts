import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError } from '@/lib/ai/run';
import type { CategoryRow } from '@/lib/products/aiPatch';
import {
  CATEGORY_SLUGS,
  ATTR_REFERENCE,
  resolveVisionCategory,
} from '@/lib/products/visionShared';

/**
 * Estrazione MULTI-prodotto da foto (vision).
 *
 * A differenza di /api/vision/extract-product (un solo prodotto da 1-4 foto),
 * qui il venditore carica un mucchio di foto di PIÙ prodotti — di norma 2 a
 * testa (fronte + retro) — e il modello le RAGGRUPPA per prodotto e estrae ogni
 * scheda in un colpo solo. Non salva nulla: ritorna la lista di bozze proposte
 * (con gli indici delle foto che appartengono a ciascun prodotto) che la UI fa
 * rivedere e poi crea via /api/ai/catalog-create-bulk (human-in-the-loop).
 *
 * Esperti senior consultati:
 * - Marketplace PM: "Caricare un intero scaffale deve costare un gesto."
 * - Staff Eng: "Una sola via per le chiamate AI: runMessage. Categoria risolta
 *   in memoria una volta sola, niente query per prodotto."
 * - Finance: "Vision su molte foto costa: cap su foto e prodotti, rate limit."
 * - Trust & Safety: "Gate policy per ogni prodotto; i bloccati tornano marcati."
 */

export const runtime = 'nodejs';

const MAX_IMAGES = 12; // ~6 prodotti (fronte+retro). Cap su costo/token.
const MAX_PRODUCTS = 12;

type ProductExtract = {
  image_indexes?: number[];
  name?: string;
  description?: string;
  category_slug?: string;
  subcategory?: string;
  suggested_price_eur?: number;
  attributes?: Record<string, string>;
  tags?: string[];
  alt_text?: string;
  policy_ok?: boolean;
  policy_reason?: string;
};
type ExtractInput = { products?: ProductExtract[] };

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'extract_products',
  description:
    'Raggruppa le foto fornite in prodotti distinti ed estrae i dettagli di ognuno. Usa sempre questo tool, non rispondere mai in testo libero.',
  input_schema: {
    type: 'object',
    properties: {
      products: {
        type: 'array',
        description:
          'Un elemento per ogni prodotto FISICO distinto riconosciuto nelle foto. Foto dello stesso oggetto (fronte/retro/etichetta) vanno nello STESSO prodotto.',
        items: {
          type: 'object',
          properties: {
            image_indexes: {
              type: 'array',
              items: { type: 'number' },
              description:
                'Indici (0-based) delle foto fornite che mostrano QUESTO prodotto. Di solito 2: fronte + retro. Almeno uno.',
            },
            name: {
              type: 'string',
              description:
                'Nome in italiano, breve (3-50 caratteri). Deve indicare l\'OGGETTO FISICO mostrato (cosa È), non il marchio/logo stampato sopra.',
            },
            description: {
              type: 'string',
              description: 'Descrizione in italiano, 1-3 frasi (15-200 caratteri), caratteristiche visibili e uso.',
            },
            category_slug: {
              type: 'string',
              enum: [...CATEGORY_SLUGS],
              description: 'Categoria del marketplace, ESATTAMENTE una tra quelle elencate.',
            },
            subcategory: {
              type: 'string',
              description: 'Nome della sottocategoria più adatta, in italiano. Vuoto se non sei sicuro.',
            },
            suggested_price_eur: {
              type: 'number',
              description: 'Prezzo di vendita suggerito in euro (numero positivo, max 2 decimali).',
            },
            attributes: {
              type: 'object',
              description:
                'Caratteristiche deducibili dalle foto come chiave→valore. Dopo aver scelto category_slug usa SOLO le chiavi previste per quella categoria; per i campi a scelta usa esattamente uno dei valori ammessi; per i sì/no usa "true"/"false". Non inventare.',
              additionalProperties: { type: 'string' },
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Da 3 a 8 parole chiave brevi in italiano (lowercase) con cui un cliente cercherebbe il prodotto reale. La prima è il tipo di oggetto.',
            },
            alt_text: {
              type: 'string',
              description: 'Testo alternativo (alt) in italiano per la foto principale, 5-15 parole.',
            },
            policy_ok: {
              type: 'boolean',
              description:
                'false se il prodotto NON è ammesso (armi, droga, contraffazione, contenuti per adulti, animali vivi, farmaci da prescrizione). true negli altri casi.',
            },
            policy_reason: {
              type: 'string',
              description: 'Se policy_ok=false, motivo breve e oggettivo.',
            },
          },
          required: ['image_indexes', 'name', 'category_slug', 'suggested_price_eur', 'policy_ok'],
        },
      },
    },
    required: ['products'],
  },
};

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const ImageItem = z.object({
  image_base64: z.string().min(1),
  media_type: z.enum(MEDIA_TYPES),
});
const BodySchema = z.object({
  images: z.array(ImageItem).min(2).max(MAX_IMAGES),
});

function buildPrompt(imageCount: number): string {
  return `Sei un assistente per il marketplace locale italiano MyCity. Ti vengono fornite ${imageCount} foto NUMERATE da 0 a ${imageCount - 1}, nell'ordine in cui le vedi. Mostrano PIÙ prodotti diversi: di solito ogni prodotto ha 2 foto (fronte + retro/etichetta), ma può averne 1 o più di 2. Il tuo compito è RAGGRUPPARE le foto per prodotto e compilare la scheda di ognuno, chiamando il tool extract_products.

Come raggruppare:
- Metti nello STESSO prodotto le foto che mostrano lo STESSO oggetto fisico (es. fronte e retro della stessa confezione, o l'etichetta dello stesso articolo). Indica gli indici in image_indexes.
- Crea un elemento "products" separato per ogni oggetto distinto. Non fondere prodotti diversi; non spezzare lo stesso prodotto in due.
- Ogni foto va assegnata a un solo prodotto. Se una foto è ambigua o non mostra un prodotto vendibile, ignorala (non assegnarla).

Per ogni prodotto (stesse regole dell'inserimento singolo):
- Identifica l'OGGETTO FISICO realmente mostrato (cosa È, la sua funzione), NON il marchio/logo/testo stampato sopra. Es. un porta-tovaglioli con il logo di un caffè è un porta-tovaglioli (casa), non caffè.
- Nome, categoria, sottocategoria e tag devono descrivere lo STESSO oggetto reale. Scegli la categoria in base alla funzione.
- Integra fronte + retro/etichetta: leggi dal retro ingredienti, valori nutrizionali, allergeni, peso/volume, scadenza, composizione/materiale, specifiche e il codice a barre EAN, e compila i campi mancanti.
- Prezzo realistico per il mercato italiano al dettaglio. Descrizione in italiano, tono neutro e informativo.
- Compila attributes nel modo PIÙ COMPLETO possibile: dopo la categoria, riempi TUTTE le chiavi deducibili (anche le tendine, scegliendo esattamente uno dei valori ammessi). Ometti solo ciò che non è ricavabile: non inventare.
- Proponi sempre 3-8 tag e, quando puoi, la sottocategoria.
- policy_ok: false e policy_reason se il prodotto non è ammesso.

Attributi per categoria (usa SOLO le chiavi della categoria scelta; per i campi "uno tra" scegli esattamente uno dei valori elencati):
${ATTR_REFERENCE}`;
}

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato sul server.');

  // Rate limit: 6 chiamate / 10 min (ogni call analizza molte foto = costosa).
  const rl = rateLimit({ key: `vision-multi:${user.id}`, max: 6, windowMs: 10 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return ApiErrors.invalidRequest('Body JSON non valido.');
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return ApiErrors.invalidRequest('Servono da 2 a 12 foto valide (image_base64 + media_type).');
  }

  const images = parsed.data.images;
  for (const img of images) {
    if (!BASE64_RE.test(img.image_base64.slice(0, 4096))) {
      return ApiErrors.invalidRequest('image_base64 non è un valore base64 valido.');
    }
    if (img.image_base64.length > 7_500_000) {
      return ApiErrors.payloadTooLarge('Immagine troppo grande. Massimo 5 MB.');
    }
  }

  // Le foto come content block, precedute da un'etichetta con l'indice, così il
  // modello può riferirsi a "foto N" e popolare image_indexes coerentemente.
  const content: Anthropic.ContentBlockParam[] = [];
  images.forEach((img, i) => {
    content.push({ type: 'text', text: `Foto ${i}:` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.media_type, data: img.image_base64 },
    });
  });
  content.push({ type: 'text', text: buildPrompt(images.length) });

  let products: ProductExtract[];
  try {
    const result = await runMessage<ExtractInput>({
      feature: 'vision-extract-multi',
      model: MODELS.vision,
      max_tokens: 4096,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: 'extract_products' },
      messages: [{ role: 'user', content }],
    });
    if (!result.toolInput?.products || !Array.isArray(result.toolInput.products)) {
      logger.error('vision-multi: nessun prodotto estratto', { feature: 'vision-extract-multi' });
      return ApiErrors.badGateway('Risposta AI inattesa. Riprova.');
    }
    products = result.toolInput.products.slice(0, MAX_PRODUCTS);
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('API key Anthropic non valida.');
    const status = err instanceof AiCallError ? err.status : undefined;
    logger.error('vision-multi: errore Anthropic', { feature: 'vision-extract-multi', status });
    if (status === 401) return ApiErrors.unavailable('API key Anthropic non valida.');
    if (status === 429) return ApiErrors.rateLimited(60);
    return ApiErrors.badGateway('Errore nel servizio AI. Riprova.');
  }

  // Categorie caricate una volta: risoluzione in memoria per ogni prodotto.
  const { data: categoriesData } = await getAdminSupabase()
    .from('categories')
    .select('id, name, slug, parent_id')
    .order('name');
  const categories = (categoriesData ?? []) as CategoryRow[];

  const out = products
    .map((p) => {
      // image_indexes validi e unici dentro il range delle foto fornite.
      const indexes = Array.isArray(p.image_indexes)
        ? Array.from(
            new Set(
              p.image_indexes.filter(
                (n): n is number => Number.isInteger(n) && n >= 0 && n < images.length,
              ),
            ),
          )
        : [];

      const cat = resolveVisionCategory(categories, p.category_slug, p.subcategory);

      const attributes: Record<string, string> = {};
      if (p.attributes && typeof p.attributes === 'object') {
        for (const [k, v] of Object.entries(p.attributes)) {
          if (typeof v === 'string' && v.trim()) attributes[k] = v.trim();
        }
      }

      const tags: string[] = [];
      if (Array.isArray(p.tags)) {
        for (const raw of p.tags) {
          if (typeof raw !== 'string') continue;
          const t = raw.trim().toLowerCase().replace(/,+$/, '');
          if (t && t.length <= 30 && !tags.includes(t)) tags.push(t);
          if (tags.length >= 8) break;
        }
      }

      return {
        image_indexes: indexes,
        name: typeof p.name === 'string' ? p.name.trim() : '',
        description: typeof p.description === 'string' ? p.description.trim() : '',
        category_id: cat.categoryId,
        subcategory_id: cat.subcategoryId,
        category_slug: typeof p.category_slug === 'string' ? p.category_slug : null,
        category_name: cat.categoryName,
        suggested_price:
          typeof p.suggested_price_eur === 'number' && p.suggested_price_eur > 0
            ? Math.round(p.suggested_price_eur * 100) / 100
            : null,
        attributes,
        tags,
        alt_text: typeof p.alt_text === 'string' ? p.alt_text.trim() : null,
        policy_ok: p.policy_ok !== false,
        policy_reason: typeof p.policy_reason === 'string' ? p.policy_reason.trim() : null,
      };
    })
    // Senza foto valide non possiamo creare un prodotto: scartiamo.
    .filter((p) => p.image_indexes.length > 0);

  return NextResponse.json({ products: out });
});

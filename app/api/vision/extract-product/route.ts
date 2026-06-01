import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError } from '@/lib/ai/run';

/**
 * Estrazione prodotto da foto (vision).
 *
 * Esperti senior consultati:
 * - Marketplace PM: "Inserire un prodotto deve costare quasi zero sforzo."
 * - Staff Eng: "Una sola via per le chiamate AI: runMessage (caching + telemetria)."
 * - Trust & Safety: "Solo seller approvati. Rate limit aggressivo (Sonnet costa)."
 */

// Eseguito sempre lato server, mai bundled nel client.
export const runtime = 'nodejs';

const CATEGORY_SLUGS = [
  'alimentari',
  'abbigliamento',
  'casa',
  'elettronica',
  'libri',
  'giardino',
  'bellezza',
  'sport',
] as const;

type CategorySlug = (typeof CATEGORY_SLUGS)[number];

type ExtractInput = {
  name: string;
  description: string;
  category_slug: CategorySlug;
  suggested_price_eur: number;
  attributes?: Record<string, string>;
  image_quality?: { score?: number; issues?: string[] };
  alt_text?: string;
  policy_ok?: boolean;
  policy_reason?: string;
};

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'extract_product',
  description:
    'Estrae i dettagli di un prodotto in vendita da un\'immagine. Usa sempre questo tool, non rispondere mai in testo libero.',
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          'Nome del prodotto in italiano, breve (3-50 caratteri). Es. "Pomodori ciliegino bio" o "Cuffie Bluetooth wireless".',
      },
      description: {
        type: 'string',
        description:
          'Descrizione del prodotto in italiano, 1-3 frasi (15-200 caratteri). Concisa, descrive caratteristiche visibili e uso tipico.',
      },
      category_slug: {
        type: 'string',
        enum: [...CATEGORY_SLUGS],
        description:
          'La categoria del marketplace piu\' adatta. Deve essere ESATTAMENTE una di: alimentari, abbigliamento, casa, elettronica, libri, giardino, bellezza, sport.',
      },
      suggested_price_eur: {
        type: 'number',
        description:
          'Prezzo di vendita suggerito in euro, basato sul tipo di prodotto. Numero positivo con al massimo 2 decimali. Es. 3.50, 19.90, 145.',
      },
      attributes: {
        type: 'object',
        description:
          'Caratteristiche del prodotto chiaramente visibili in foto. Compila SOLO i campi deducibili con certezza; OMETTI del tutto gli altri (non inventare).',
        properties: {
          marca: { type: 'string', description: 'Marca / brand se visibile. Es. "Apple", "Barilla".' },
          modello: { type: 'string', description: 'Modello, se indicato. Es. "iPhone 15 Pro".' },
          colore: { type: 'string', description: 'Colore prevalente. Es. "Nero", "Blu navy".' },
          taglia: { type: 'string', description: 'Taglia, se applicabile (abbigliamento/sport). Es. "M", "42".' },
          materiale: { type: 'string', description: 'Materiale principale. Es. "Cotone 100%", "Legno di rovere".' },
          peso: { type: 'string', description: 'Peso o quantità. Es. "500g", "1L", "6 pezzi".' },
          dimensioni: { type: 'string', description: 'Dimensioni. Es. "60x40x30 cm".' },
          condizione: { type: 'string', description: 'Stato / condizione. Es. "Nuovo", "Usato come nuovo".' },
          origine: { type: 'string', description: 'Origine / provenienza (alimentari). Es. "Italia", "Sicilia".' },
          allergeni: { type: 'string', description: 'Allergeni (alimentari), se leggibili in etichetta.' },
          ingredienti: { type: 'string', description: 'Ingredienti principali (alimentari), se leggibili.' },
          scadenza: { type: 'string', description: 'Data di scadenza in formato ISO YYYY-MM-DD, se leggibile.' },
          ean: { type: 'string', description: 'Codice a barre EAN/GTIN (8-14 cifre), se leggibile sul retro o sull\'etichetta.' },
        },
      },
      image_quality: {
        type: 'object',
        description: 'Valutazione della qualità della foto principale per la vendita online.',
        properties: {
          score: {
            type: 'number',
            description: 'Qualità complessiva da 0 (inutilizzabile) a 1 (ottima): nitidezza, luce, inquadratura, sfondo.',
          },
          issues: {
            type: 'array',
            items: { type: 'string' },
            description: 'Problemi rilevati. Es. "sfocata", "poca luce", "sfondo disordinato", "prodotto non centrato".',
          },
        },
        required: ['score'],
      },
      alt_text: {
        type: 'string',
        description:
          'Testo alternativo (alt) in italiano per la foto principale: descrive il prodotto in 5-15 parole per screen reader (accessibilità EAA).',
      },
      policy_ok: {
        type: 'boolean',
        description:
          'false se il prodotto NON è ammesso sul marketplace (armi, droga, contraffazione, contenuti per adulti, animali vivi, farmaci da prescrizione). true negli altri casi.',
      },
      policy_reason: {
        type: 'string',
        description: 'Se policy_ok=false, motivo breve e oggettivo del blocco.',
      },
    },
    required: ['name', 'description', 'category_slug', 'suggested_price_eur', 'image_quality', 'alt_text', 'policy_ok'],
  },
};

const PROMPT_TEXT = `Sei un assistente per un marketplace locale italiano chiamato MyCity. Analizza la foto del prodotto allegata e compila i campi del nuovo annuncio chiamando il tool extract_product.

Linee guida:
- Sii specifico ma sintetico: "Pomodori ciliegino" e' meglio di "Verdura".
- Se l'immagine non mostra chiaramente un prodotto in vendita (es. e' un selfie, un panorama, un foglio bianco), chiama comunque il tool ma metti nome="Prodotto generico", descrizione vuota e categoria che ritieni piu' probabile.
- Il prezzo suggerito deve essere realistico per il mercato italiano al dettaglio.
- Descrizione in italiano, in tono neutro e informativo.
- Compila l'oggetto attributes con le caratteristiche chiaramente visibili (marca, colore, taglia, materiale, peso/dimensioni, condizione; per gli alimentari anche origine, allergeni, ingredienti, scadenza). Ometti i campi non deducibili dalla foto: non inventare.
- Se ricevi piu' foto, integrale: di solito una mostra il fronte e una il retro/etichetta. Leggi dall'etichetta marca, ingredienti, allergeni, peso e il codice a barre EAN quando presenti.`;

// Validazione base64 (solo charset, no padding strict)
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

const ImageItem = z.object({
  image_base64: z.string().min(1),
  media_type: z.enum(MEDIA_TYPES),
});

// Accetta sia images[] (2-4 foto: fronte + etichetta) sia il payload singolo legacy.
const BodySchema = z.object({
  images: z.array(ImageItem).min(1).max(4).optional(),
  image_base64: z.string().min(1).optional(),
  media_type: z.enum(MEDIA_TYPES).optional(),
});

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato sul server.');

  // Rate limit: 10 chiamate / 5 min per utente (Anthropic costa)
  const rl = rateLimit({
    key: `vision:${user.id}`,
    max: 10,
    windowMs: 5 * 60_000,
  });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  // Parsing + validazione body
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return ApiErrors.invalidRequest('Body JSON non valido.');
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    // media_type non valido o struttura images[] errata
    return ApiErrors.invalidRequest('media_type deve essere image/jpeg, image/png, image/webp o image/gif.');
  }

  // Normalizza in una lista di immagini (images[] oppure singola legacy).
  let images: { image_base64: string; media_type: MediaType }[];
  if (parsed.data.images) {
    images = parsed.data.images;
  } else if (parsed.data.image_base64 && parsed.data.media_type) {
    images = [{ image_base64: parsed.data.image_base64, media_type: parsed.data.media_type }];
  } else {
    return ApiErrors.invalidRequest('Campo image_base64 mancante.');
  }

  for (const img of images) {
    if (!BASE64_RE.test(img.image_base64.slice(0, 4096))) {
      return ApiErrors.invalidRequest('image_base64 non è un valore base64 valido.');
    }
    // base64 ~= 4/3 byte raw, accettiamo fino a ~5 MB raw = ~7 MB base64.
    if (img.image_base64.length > 7_500_000) {
      return ApiErrors.payloadTooLarge('Immagine troppo grande. Massimo 5 MB.');
    }
  }

  let toolInput: ExtractInput;
  try {
    const result = await runMessage<ExtractInput>({
      feature: 'vision-extract',
      model: MODELS.vision,
      max_tokens: 512,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: 'extract_product' },
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((img) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: img.media_type,
                data: img.image_base64,
              },
            })),
            { type: 'text' as const, text: PROMPT_TEXT },
          ],
        },
      ],
    });

    if (!result.toolInput) {
      logger.error('Anthropic non ha restituito un tool_use', { feature: 'vision-extract' });
      return ApiErrors.badGateway('Risposta AI inattesa. Riprova.');
    }
    toolInput = result.toolInput;
  } catch (err) {
    // Log solo lo status, mai il messaggio raw (potrebbe contenere
    // frammenti della API key o dell'input).
    if (err instanceof AiConfigError) return ApiErrors.unavailable('API key Anthropic non valida.');
    const status = err instanceof AiCallError ? err.status : undefined;
    logger.error('Errore chiamata Anthropic', { feature: 'vision-extract', status });
    if (status === 401) return ApiErrors.unavailable('API key Anthropic non valida.');
    if (status === 429) return ApiErrors.rateLimited(60);
    return ApiErrors.badGateway('Errore nel servizio AI. Riprova.');
  }

  // Gate policy: blocca i prodotti vietati prima di compilare l'annuncio.
  if (toolInput.policy_ok === false) {
    const reason = toolInput.policy_reason?.trim();
    return ApiErrors.invalidRequest(
      reason
        ? `Questo prodotto non può essere pubblicato su MyCity: ${reason}`
        : 'Questo prodotto non può essere pubblicato su MyCity.',
    );
  }

  // Lookup category_id da slug
  let categoryId: string | null = null;
  try {
    const supa = await getServerSupabase();
    const { data } = await supa
      .from('categories')
      .select('id')
      .eq('slug', toolInput.category_slug)
      .is('parent_id', null)
      .single();
    categoryId = data?.id ?? null;
  } catch {
    // categoria opzionale: ok proseguire con null
  }

  // Normalizza gli attributi: solo stringhe non vuote, trim.
  const attributes: Record<string, string> = {};
  if (toolInput.attributes && typeof toolInput.attributes === 'object') {
    for (const [k, v] of Object.entries(toolInput.attributes)) {
      if (typeof v === 'string' && v.trim()) attributes[k] = v.trim();
    }
  }

  const score = toolInput.image_quality?.score;
  const imageQuality =
    typeof score === 'number'
      ? { score, issues: Array.isArray(toolInput.image_quality?.issues) ? toolInput.image_quality!.issues : [] }
      : null;

  return NextResponse.json({
    name: toolInput.name,
    description: toolInput.description,
    category_id: categoryId,
    category_slug: toolInput.category_slug,
    suggested_price: toolInput.suggested_price_eur,
    attributes,
    image_quality: imageQuality,
    alt_text: typeof toolInput.alt_text === 'string' ? toolInput.alt_text.trim() : null,
  });
});

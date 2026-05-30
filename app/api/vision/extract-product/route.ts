import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSupabase } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

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
};

const EXTRACT_TOOL = {
  name: 'extract_product',
  description:
    'Estrae i dettagli di un prodotto in vendita da un\'immagine. Usa sempre questo tool, non rispondere mai in testo libero.',
  input_schema: {
    type: 'object' as const,
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
    },
    required: ['name', 'description', 'category_slug', 'suggested_price_eur'],
  },
};

const PROMPT_TEXT = `Sei un assistente per un marketplace locale italiano chiamato MyCity. Analizza la foto del prodotto allegata e compila i campi del nuovo annuncio chiamando il tool extract_product.

Linee guida:
- Sii specifico ma sintetico: "Pomodori ciliegino" e' meglio di "Verdura".
- Se l'immagine non mostra chiaramente un prodotto in vendita (es. e' un selfie, un panorama, un foglio bianco), chiama comunque il tool ma metti nome="Prodotto generico", descrizione vuota e categoria che ritieni piu' probabile.
- Il prezzo suggerito deve essere realistico per il mercato italiano al dettaglio.
- Descrizione in italiano, in tono neutro e informativo.`;

// Validazione base64 (solo charset, no padding strict)
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return ApiErrors.unavailable('Servizio AI non configurato sul server.');

  // Rate limit: 10 chiamate / 5 min per utente (Anthropic costa)
  const rl = rateLimit({
    key: `vision:${user.id}`,
    max: 10,
    windowMs: 5 * 60_000,
  });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  // Parsing + validazione body
  let body: { image_base64?: string; media_type?: string };
  try {
    body = await req.json();
  } catch {
    return ApiErrors.invalidRequest('Body JSON non valido.');
  }

  const { image_base64, media_type } = body;
  if (!image_base64 || typeof image_base64 !== 'string') {
    return ApiErrors.invalidRequest('Campo image_base64 mancante.');
  }
  if (!media_type || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(media_type)) {
    return ApiErrors.invalidRequest('media_type deve essere image/jpeg, image/png, image/webp o image/gif.');
  }
  if (!BASE64_RE.test(image_base64.slice(0, 4096))) {
    return ApiErrors.invalidRequest('image_base64 non è un valore base64 valido.');
  }

  // base64 ~= 4/3 byte raw, accettiamo fino a ~5 MB raw = ~7 MB base64.
  if (image_base64.length > 7_500_000) {
    return ApiErrors.payloadTooLarge('Immagine troppo grande. Massimo 5 MB.');
  }

  const anthropic = new Anthropic({ apiKey });

  let toolInput: ExtractInput;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: 'extract_product' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: media_type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                data: image_base64,
              },
            },
            { type: 'text', text: PROMPT_TEXT },
          ],
        },
      ],
    });

    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      logger.error('Anthropic non ha restituito un tool_use');
      return ApiErrors.badGateway('Risposta AI inattesa. Riprova.');
    }
    toolInput = toolBlock.input as ExtractInput;
  } catch (err) {
    // Log solo lo status code, mai il messaggio raw (potrebbe contenere
    // frammenti della API key o dell'input).
    const status = (err as { status?: number } | null)?.status;
    logger.error('Errore chiamata Anthropic, status:', status);
    if (status === 401) return ApiErrors.unavailable('API key Anthropic non valida.');
    if (status === 429) return ApiErrors.rateLimited(60);
    return ApiErrors.badGateway('Errore nel servizio AI. Riprova.');
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

  return NextResponse.json({
    name: toolInput.name,
    description: toolInput.description,
    category_id: categoryId,
    category_slug: toolInput.category_slug,
    suggested_price: toolInput.suggested_price_eur,
  });
});

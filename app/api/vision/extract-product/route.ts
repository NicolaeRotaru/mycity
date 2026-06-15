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
import { CATEGORY_ATTRIBUTES } from '@/lib/category-attributes';

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
  subcategory?: string;
  suggested_price_eur: number;
  attributes?: Record<string, string>;
  tags?: string[];
  image_quality?: { score?: number; issues?: string[] };
  alt_text?: string;
  policy_ok?: boolean;
  policy_reason?: string;
  confidence?: number;
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
          'Nome del prodotto in italiano, breve (3-50 caratteri). Deve indicare l\'OGGETTO FISICO realmente mostrato in foto (cosa È), non il marchio/logo/testo stampato sopra di esso. Es. "Pomodori ciliegino bio", "Cuffie Bluetooth wireless", "Porta tovaglioli in metallo". Un porta-tovaglioli con il logo di un caffè resta un porta-tovaglioli, non caffè.',
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
      subcategory: {
        type: 'string',
        description:
          'Nome della sottocategoria piu\' adatta dentro la categoria scelta, in italiano e per esteso. Es. per libri "Saggistica", "Romanzi", "Crescita personale"; per elettronica "Smartphone", "Audio". Lascia vuoto se non sei sicuro: il server prova a far corrispondere il testo a una sottocategoria esistente.',
      },
      suggested_price_eur: {
        type: 'number',
        description:
          'Prezzo di vendita suggerito in euro, basato sul tipo di prodotto. Numero positivo con al massimo 2 decimali. Es. 3.50, 19.90, 145.',
      },
      attributes: {
        type: 'object',
        description:
          'Caratteristiche del prodotto deducibili dalle foto, come coppie chiave→valore (testo). DOPO aver scelto category_slug, usa ESCLUSIVAMENTE le chiavi previste per quella categoria (vedi "Attributi per categoria" nel prompt) e compila TUTTE quelle deducibili dalle foto, incluse quelle leggibili sul retro/etichetta. Per i campi con valori elencati usa ESATTAMENTE uno di quei valori; per i sì/no usa "true"/"false". Ometti ciò che non è deducibile: non inventare.',
        additionalProperties: { type: 'string' },
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Da 3 a 8 parole chiave brevi in italiano (lowercase, una o due parole ciascuna) con cui un cliente cercherebbe questo prodotto. Devono descrivere l\'OGGETTO REALE e le sue caratteristiche fisiche (tipo di oggetto, materiale, uso, stanza/contesto), NON il marchio o il logo stampato sopra. La prima parola chiave deve essere il tipo di oggetto. Es. per un porta-tovaglioli in metallo con un logo: ["porta tovaglioli", "tovaglioli", "metallo", "cucina", "tavola"], NON ["caffè", "espresso", "grani"]. Es. per un libro di strategia: ["crescita personale", "strategia", "saggistica", "potere"]. Non ripetere il nome esatto del prodotto; usa termini di ricerca utili.',
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
      confidence: {
        type: 'number',
        description:
          'Quanto sei sicuro dell\'IDENTITÀ del prodotto (cosa è esattamente, e marca/modello quando rilevanti), da 0 (incerto) a 1 (certo). Abbassala sotto 0.7 se: lo stesso nome potrebbe appartenere a prodotti di aziende diverse, non riesci a leggere con certezza marca/modello dalla foto, o il prezzo di mercato ti è poco chiaro.',
      },
    },
    required: ['name', 'description', 'category_slug', 'suggested_price_eur', 'image_quality', 'alt_text', 'policy_ok', 'confidence'],
  },
};

/**
 * Server tool gestito da Anthropic: esegue le ricerche dentro la stessa call.
 * Usato solo nel secondo passaggio di verifica, quando la confidenza è bassa.
 */
const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 3,
  user_location: { type: 'approximate', country: 'IT' },
};

/** Sotto questa confidenza facciamo un secondo passaggio con ricerca web. */
const CONFIDENCE_THRESHOLD = 0.7;

// Riferimento chiavi attributo per categoria, generato dallo schema condiviso:
// così il modello compila gli stessi campi del form (incluse le tendine) usando
// esattamente le chiavi e i valori ammessi.
const ATTR_REFERENCE = Object.entries(CATEGORY_ATTRIBUTES)
  .map(([slug, fields]) => {
    const parts = fields.map((f) => {
      if (f.type === 'select' && f.options?.length) return `${f.key} (uno tra: ${f.options.join(' | ')})`;
      if (f.type === 'checkbox') return `${f.key} (true/false)`;
      if (f.type === 'number') return `${f.key} (numero)`;
      if (f.type === 'date') return `${f.key} (data AAAA-MM-GG)`;
      return f.key;
    });
    return `- ${slug}: ${parts.join(', ')}`;
  })
  .join('\n');

const PROMPT_TEXT = `Sei un assistente per un marketplace locale italiano chiamato MyCity. Analizza la foto del prodotto allegata e compila i campi del nuovo annuncio chiamando il tool extract_product.

Linee guida:
- PRIMA REGOLA: identifica l'OGGETTO FISICO realmente mostrato in foto (cosa È, qual è la sua funzione), NON il marchio, il logo, l'etichetta o il testo stampato sopra di esso. Esempi: un porta-tovaglioli con il logo di una marca di caffè è un porta-tovaglioli (casa/cucina), non caffè e non una bevanda; una tazza con scritto "tè" è una tazza; una shopper con un logo è una borsa. Distingui sempre il prodotto dal branding/decorazione che riporta. Usa il marchio solo per il campo attributes.marca, mai per decidere cosa sia l'oggetto.
- Coerenza: nome, categoria, sottocategoria e tag devono descrivere tutti lo STESSO oggetto reale. Scegli la categoria in base alla funzione dell'oggetto (es. un porta-tovaglioli va in "casa"), non in base al brand stampato.
- Sii specifico ma sintetico: "Pomodori ciliegino" e' meglio di "Verdura".
- Se l'immagine non mostra chiaramente un prodotto in vendita (es. e' un selfie, un panorama, un foglio bianco), chiama comunque il tool ma metti nome="Prodotto generico", descrizione vuota e categoria che ritieni piu' probabile.
- Il prezzo suggerito deve essere realistico per il mercato italiano al dettaglio.
- Descrizione in italiano, in tono neutro e informativo.
- Compila l'oggetto attributes nel modo PIÙ COMPLETO possibile: dopo aver scelto la categoria, riempi TUTTE le chiavi di quella categoria che riesci a dedurre dalle foto (anche quelle a tendina, scegliendo esattamente uno dei valori ammessi — es. per bellezza tipo_prodotto="Maschera"). Non lasciare vuoto un campo se l'informazione è leggibile o chiaramente deducibile. Ometti solo ciò che davvero non è ricavabile: non inventare.
- Se il prodotto e' un libro, usa come nome il titolo del libro e compila gli attributi del libro leggibili da copertina, costa e retro: autore, editore, anno (4 cifre), pagine (solo cifre), lingua, isbn (10 o 13 cifre dal codice a barre) e formato (esattamente: Brossura, Cartonato, Tascabile, Audiolibro o Ebook).
- Proponi sempre la sottocategoria piu' adatta (campo subcategory) e da 3 a 8 tag/parole chiave di ricerca (campo tags), anche quando non sono scritti in foto ma sono chiaramente deducibili dal tipo di prodotto.
- FOTO MULTIPLE: la prima foto è di solito il fronte (nome, marca, "faccia" del prodotto); le altre mostrano spesso il retro o l'etichetta. INTEGRA tutte le foto come un unico prodotto: leggi dal retro/etichetta ingredienti, valori nutrizionali, allergeni, peso/volume, scadenza, composizione/materiale, specifiche tecniche e il codice a barre EAN, e usali per compilare i campi mancanti.
- Imposta il campo confidence in modo onesto: quanto sei sicuro dell'identità del prodotto. Abbassala sotto 0.7 se lo stesso nome potrebbe appartenere a prodotti di aziende diverse, se non leggi con certezza marca/modello, o se il prezzo di mercato non ti è chiaro: in quel caso il sistema farà una verifica online.

Attributi per categoria (usa SOLO le chiavi della categoria scelta; per i campi "uno tra" scegli esattamente uno dei valori elencati):
${ATTR_REFERENCE}`;

// Validazione base64 (solo charset, no padding strict)
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

const ImageItem = z.object({
  image_base64: z.string().min(1),
  media_type: z.enum(MEDIA_TYPES),
});

// Accetta images[] (2-4 foto: fronte + etichetta), il payload singolo legacy,
// oppure image_urls[] (foto già caricate su storage: le usa la chat Assistenza).
const BodySchema = z.object({
  images: z.array(ImageItem).min(1).max(4).optional(),
  image_base64: z.string().min(1).optional(),
  media_type: z.enum(MEDIA_TYPES).optional(),
  image_urls: z.array(z.string().url()).min(1).max(4).optional(),
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

  // Blocchi immagine riusati sia per l'estrazione che per l'eventuale verifica.
  // Tre sorgenti: image_urls[] (foto su storage), images[] o singola legacy (base64).
  let imageBlocks: Anthropic.ImageBlockParam[];
  if (parsed.data.image_urls) {
    const urls = parsed.data.image_urls.filter((u) => /^https?:\/\//i.test(u));
    if (urls.length === 0) return ApiErrors.invalidRequest('image_urls non valido.');
    imageBlocks = urls.map((url) => ({ type: 'image', source: { type: 'url', url } }));
  } else {
    // Normalizza in una lista di immagini base64 (images[] oppure singola legacy).
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

    imageBlocks = images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.media_type, data: img.image_base64 },
    }));
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
          content: [...imageBlocks, { type: 'text' as const, text: PROMPT_TEXT }],
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

  // Secondo passaggio (solo quando serve): se il modello è poco sicuro
  // dell'identità del prodotto, lascia che cerchi sul web per correggersi.
  // Lo stesso nome può appartenere a prodotti di aziende diverse: la sola
  // foto non basta a distinguerli, la ricerca sì.
  const isGeneric = /prodotto generico/i.test(toolInput.name ?? '');
  const needsVerification =
    !isGeneric &&
    toolInput.policy_ok !== false &&
    typeof toolInput.confidence === 'number' &&
    toolInput.confidence < CONFIDENCE_THRESHOLD;

  if (needsVerification) {
    const verifyPrompt = `Hai estratto questi dati dalle foto con BASSA confidenza (${toolInput.confidence}):
${JSON.stringify(
      {
        name: toolInput.name,
        description: toolInput.description,
        category_slug: toolInput.category_slug,
        subcategory: toolInput.subcategory,
        suggested_price_eur: toolInput.suggested_price_eur,
        attributes: toolInput.attributes,
      },
      null,
      2,
    )}

Usa lo strumento web_search per IDENTIFICARE con certezza il prodotto reale mostrato nelle foto: lo stesso nome può appartenere a prodotti/aziende diverse, quindi incrocia ciò che vedi (forma, etichetta, marca, modello, eventuale codice a barre) con la ricerca. Verifica anche un prezzo di mercato italiano realistico. Poi richiama SEMPRE extract_product con i dati CORRETTI e una confidence aggiornata. Se la ricerca conferma i dati, richiamali invariati.`;

    try {
      const verify = await runMessage<ExtractInput>({
        feature: 'vision-extract-verify',
        model: MODELS.vision,
        max_tokens: 1024,
        tools: [WEB_SEARCH_TOOL, EXTRACT_TOOL],
        tool_choice: { type: 'auto' },
        messages: [
          {
            role: 'user',
            content: [...imageBlocks, { type: 'text' as const, text: verifyPrompt }],
          },
        ],
      });
      if (verify.toolInput) {
        logger.info('vision-extract verifica web applicata', {
          before: toolInput.confidence,
          after: verify.toolInput.confidence,
        });
        toolInput = verify.toolInput;
      }
    } catch (err) {
      // Verifica best-effort: se la ricerca web fallisce, teniamo l'estrazione
      // iniziale invece di far fallire tutto l'inserimento.
      const status = err instanceof AiCallError ? err.status : undefined;
      logger.warn('vision-extract verifica web fallita, uso estrazione iniziale', {
        feature: 'vision-extract-verify',
        status,
      });
    }
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

  // Lookup category_id da slug + eventuale sottocategoria.
  // - categoryId: categoria di primo livello (sempre, se trovata).
  // - subcategoryId: sottocategoria figlia il cui nome/slug combacia col testo
  //   libero proposto dall'AT (toolInput.subcategory). Solo per auto-selezione.
  let categoryId: string | null = null;
  let subcategoryId: string | null = null;
  try {
    const supa = await getServerSupabase();
    const { data: top } = await supa
      .from('categories')
      .select('id')
      .eq('slug', toolInput.category_slug)
      .is('parent_id', null)
      .single();
    categoryId = top?.id ?? null;

    const wanted = typeof toolInput.subcategory === 'string' ? normalizeLabel(toolInput.subcategory) : '';
    if (categoryId && wanted) {
      const { data: subs } = await supa
        .from('categories')
        .select('id, name, slug')
        .eq('parent_id', categoryId);
      const match = (subs ?? []).find((s) => {
        const name = normalizeLabel(s.name ?? '');
        const slug = normalizeLabel((s.slug ?? '').replace(/-/g, ' '));
        return name === wanted || slug === wanted || name.includes(wanted) || wanted.includes(name);
      });
      subcategoryId = match?.id ?? null;
    }
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

  // Tag: stringhe brevi, lowercase, deduplicate, max 8.
  const tags: string[] = [];
  if (Array.isArray(toolInput.tags)) {
    for (const raw of toolInput.tags) {
      if (typeof raw !== 'string') continue;
      const t = raw.trim().toLowerCase().replace(/[,]+$/, '');
      if (t && t.length <= 30 && !tags.includes(t)) tags.push(t);
      if (tags.length >= 8) break;
    }
  }

  return NextResponse.json({
    name: toolInput.name,
    description: toolInput.description,
    category_id: categoryId,
    subcategory_id: subcategoryId,
    category_slug: toolInput.category_slug,
    suggested_price: toolInput.suggested_price_eur,
    attributes,
    tags,
    image_quality: imageQuality,
    alt_text: typeof toolInput.alt_text === 'string' ? toolInput.alt_text.trim() : null,
  });
});

// Normalizza un'etichetta per il confronto: minuscolo, senza accenti,
// punteggiatura ridotta a spazi e spazi collassati.
function normalizeLabel(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

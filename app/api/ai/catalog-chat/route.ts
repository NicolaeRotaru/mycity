import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { getAdminSupabase } from '@/lib/supabase/server';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';
import { getAttributesForCategory } from '@/lib/category-attributes';
import type { AiProductPatch, CategoryRow } from '@/lib/products/aiPatch';
import {
  productSnapshot as snapshot,
  PRODUCT_SNAPSHOT_COLS,
  type ProductRow,
} from '@/lib/products/aiSnapshot';

/**
 * Assistente AI della chat Assistenza — modifica veloce dei prodotti.
 *
 * A differenza di /api/ai/product-chat (che opera su UN prodotto già aperto nel
 * form), qui il venditore NON deve cercare il prodotto: descrive a parole o
 * manda una FOTO e l'assistente lo riconosce nel suo catalogo. Solo quando il
 * venditore chiede ESPLICITAMENTE una modifica l'assistente propone un patch
 * (strumento "manage_product"); altrimenti mostra i dettagli e risponde.
 *
 * Due modalità (per contenere il costo):
 * - Identificazione (nessun focusProductId): manda il catalogo come DATO
 *   (testo + miniature) + le foto del venditore → l'AI sceglie product_id.
 * - Focus (focusProductId valido): manda solo quel prodotto in dettaglio +
 *   schema attributi/categorie, come la chat del form.
 *
 * Esperti senior consultati:
 * - Prompt Engineer: "Catalogo, foto e conversazione sono DATO → messages.
 *   Il system (istruzioni) resta stabile e cacheabile."
 * - Security: "Solo seller approvati; il catalogo caricato è SEMPRE filtrato per
 *   seller_id = utente. L'AI non scrive nulla: propone, l'apply è un endpoint a
 *   parte con verifica di proprietà."
 * - Finance: "Sonnet + web search + miniature costano: catalogo cap, focus mode
 *   appena identificato il prodotto, rate limit aggressivo."
 */

export const runtime = 'nodejs';

const SYSTEM = `Sei l'assistente di "MyCity Piacenza" dentro la chat di Assistenza. Aiuti un venditore a trovare e correggere velocemente i SUOI prodotti, senza che debba cercarli a mano. Conversi in italiano, in modo caldo, concreto e onesto.

Hai a disposizione:
- l'elenco dei prodotti del venditore (catalogo) con id, nome, prezzo, stato e categoria, e — quando presenti — le loro miniature;
- le foto che il venditore manda per indicare di QUALE prodotto parla: confrontale con le miniature del catalogo per capire qual è;
- in modalità focus, lo stato completo del prodotto scelto (JSON), gli slug delle categorie e gli attributi validi;
- lo strumento "web_search" per cercare online (specifiche, prezzo di mercato, identificare il prodotto reale): usalo con parsimonia, solo se serve davvero.

Come lavori:
- Prima IDENTIFICA il prodotto. Se la foto o la descrizione combaciano con un solo prodotto, dillo e imposta "product_id". Se ci sono più candidati o non sei sicuro, NON indovinare: elenca i candidati e chiedi al venditore quale.
- Quando "product_id" è noto, puoi mostrare i dettagli, dare consigli, rispondere a domande.
- Proponi modifiche (campo "patch") SOLO quando il venditore chiede ESPLICITAMENTE di cambiare qualcosa ("metti il prezzo a…", "segna esaurito", "aggiungi il tag…"). Se chiede solo informazioni, NON mettere "patch": mostra i dettagli e basta.
- Se la richiesta è ambigua, chiedi chiarimenti a parole senza modificare nulla.

Chiama SEMPRE lo strumento "manage_product" per rispondere (anche solo per parlare): metti la tua risposta in "reply", "product_id" quando identificato, e "patch" solo se devi cambiare campi.

Regole per "patch":
- Inserisci SOLO i campi che cambiano rispetto allo stato attuale.
- Per TOGLIERE un valore: null per gli scalari (compare_at_price, condition) e "attributes_remove" per gli attributi.
- "tags" è la lista COMPLETA desiderata (ricostruiscila da quella attuale).
- "attributes" usa SOLO le chiavi degli attributi validi e, per i campi a scelta, SOLO le opzioni elencate.
- "category_slug" deve essere uno degli slug forniti; "subcategory_name" è il nome della sottocategoria.
- Prezzi in euro come numero (es. 4.90). Niente emoji.`;

const MANAGE_TOOL: Anthropic.Tool = {
  name: 'manage_product',
  description:
    'Risponde al venditore, indica quale prodotto è stato identificato e — solo se richiesto esplicitamente — propone le modifiche da applicare.',
  input_schema: {
    type: 'object',
    properties: {
      reply: {
        type: 'string',
        description: 'Risposta conversazionale in italiano per il venditore.',
      },
      product_id: {
        type: 'string',
        description:
          'ID (dal catalogo) del prodotto identificato. Ometti se non ancora certo.',
      },
      patch: {
        type: 'object',
        description:
          'Solo i campi da cambiare. Includilo SOLO se il venditore ha chiesto esplicitamente una modifica.',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          price: { type: 'number', description: 'Prezzo di vendita in euro.' },
          compare_at_price: {
            type: ['number', 'null'],
            description: 'Prezzo pieno barrato in euro. null per rimuoverlo.',
          },
          unit: {
            type: 'string',
            enum: ['pezzo', 'kg', 'g', 'l', 'ml', 'confezione', 'paio', 'm'],
          },
          condition: {
            type: ['string', 'null'],
            enum: ['nuovo', 'usato', 'ricondizionato', null],
            description: 'null per "non specificata".',
          },
          stock: { type: 'number', description: 'Disponibilità in pezzi.' },
          unlimited_stock: {
            type: 'boolean',
            description: 'true per disponibilità illimitata.',
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
          status: { type: 'string', enum: ['available', 'draft', 'sold'] },
        },
      },
    },
    required: ['reply'],
  },
};

const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 3,
  user_location: { type: 'approximate', country: 'IT' },
};

type ChatRole = 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

type CatalogChatBody = {
  history?: ChatMessage[];
  imageUrls?: string[];
  focusProductId?: string;
};

type ManageInput = { reply?: string; product_id?: string; patch?: AiProductPatch };

const MAX_IMAGES = 4; // foto inviate dal venditore
const MAX_CATALOG = 100; // prodotti elencati come testo
const MAX_CATALOG_IMAGES = 10; // miniature inviate per il match visivo
const MAX_HISTORY = 20;
const MAX_CONTENT = 2000;

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');

  const rl = await rateLimitAsync({ key: `ai-catalog-chat:${user.id}`, max: 25, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: CatalogChatBody;
  try {
    body = await req.json();
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }

  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history: ChatMessage[] = rawHistory
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0,
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT) }));

  while (history.length > 0 && history[0].role !== 'user') history.shift();
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return ApiErrors.invalidRequest('Scrivi un messaggio per l\'assistente.');
  }

  const userImages = (Array.isArray(body.imageUrls) ? body.imageUrls : [])
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, MAX_IMAGES);

  const admin = getAdminSupabase();

  // Catalogo del venditore (SEMPRE filtrato per proprietà) + categorie.
  const [{ data: productsData }, { data: categoriesData }] = await Promise.all([
    admin
      .from('products')
      .select(PRODUCT_SNAPSHOT_COLS)
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false })
      .limit(MAX_CATALOG),
    admin.from('categories').select('id, name, slug, parent_id').order('name'),
  ]);

  const products = (productsData ?? []) as ProductRow[];
  const categories = (categoriesData ?? []) as CategoryRow[];
  const topCategories = categories.filter((c) => !c.parent_id);

  if (products.length === 0) {
    return NextResponse.json({
      reply: 'Non vedo ancora prodotti nel tuo catalogo. Pubblicane uno e poi torna qui: ti aiuto a sistemarlo.',
      productId: null,
      patch: {},
      product: null,
    });
  }

  // Modalità focus se il client ci passa un prodotto valido del venditore.
  const focused = body.focusProductId
    ? products.find((p) => p.id === body.focusProductId) ?? null
    : null;

  let contextContent: Anthropic.ContentBlockParam[];

  if (focused) {
    const snap = snapshot(focused, categories);
    const { fields } = getAttributesForCategory(
      categories.map((c) => ({ id: c.id, slug: c.slug, parent_id: c.parent_id })),
      focused.category_id,
    );
    const attrLines = fields
      .map((f) => {
        const opts = f.options && f.options.length ? ` [opzioni: ${f.options.join(', ')}]` : '';
        return `- ${f.key} (${f.type})${opts}`;
      })
      .join('\n');
    const productImages = (Array.isArray(focused.images) ? focused.images : [])
      .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
      .slice(0, MAX_IMAGES);
    const text = `Stiamo lavorando su QUESTO prodotto (id=${snap.id}).
${productImages.length ? 'Le immagini qui sopra sono le sue foto reali.\n' : ''}${userImages.length ? 'Ci sono anche foto inviate ora dal venditore.\n' : ''}
Stato attuale del prodotto (JSON):
${JSON.stringify(snap, null, 2)}

Categorie di primo livello disponibili (slug):
${topCategories.map((c) => `- ${c.slug} (${c.name})`).join('\n')}

Attributi validi per la categoria attuale:
${attrLines || '- (nessuno)'}`;
    contextContent = [
      ...productImages.map(
        (url): Anthropic.ImageBlockParam => ({ type: 'image', source: { type: 'url', url } }),
      ),
      ...userImages.map(
        (url): Anthropic.ImageBlockParam => ({ type: 'image', source: { type: 'url', url } }),
      ),
      { type: 'text', text },
    ];
  } else {
    // Identificazione: foto del venditore + catalogo (testo + miniature).
    const blocks: Anthropic.ContentBlockParam[] = [];
    if (userImages.length) {
      for (const url of userImages) blocks.push({ type: 'image', source: { type: 'url', url } });
      blocks.push({
        type: 'text',
        text: 'Le foto qui sopra sono inviate dal venditore per indicare di quale prodotto parla. Confrontale con le miniature del catalogo.',
      });
    }
    const withThumb = products.filter((p) => Array.isArray(p.images) && p.images[0]).slice(0, MAX_CATALOG_IMAGES);
    for (const p of withThumb) {
      const snap = snapshot(p, categories);
      blocks.push({
        type: 'text',
        text: `Catalogo · id=${snap.id} · ${snap.name} · ${snap.price != null ? `€${snap.price}` : 's.p.'} · ${snap.status} · ${snap.categoryName ?? '—'}`,
      });
      blocks.push({ type: 'image', source: { type: 'url', url: p.images![0] as string } });
    }
    const list = products
      .map((p) => {
        const snap = snapshot(p, categories);
        return `- id=${snap.id} · ${snap.name} · ${snap.price != null ? `€${snap.price}` : 's.p.'} · ${snap.status} · ${snap.categoryName ?? '—'}`;
      })
      .join('\n');
    blocks.push({
      type: 'text',
      text: `Catalogo completo del venditore (${products.length} prodotti):
${list}

Categorie di primo livello disponibili (slug):
${topCategories.map((c) => `- ${c.slug} (${c.name})`).join('\n')}

Identifica di quale prodotto parla il venditore e imposta "product_id". Se non sei sicuro, chiedi.`,
    });
    contextContent = blocks;
  }

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: contextContent },
    {
      role: 'assistant',
      content: focused
        ? 'Ricevuto, ho la scheda del prodotto davanti. Dimmi cosa vuoi fare.'
        : 'Ricevuto, ho il tuo catalogo davanti. Dimmi qual è il prodotto o mandami una foto.',
    },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    const { text, toolInput } = await runMessage<ManageInput>({
      feature: 'ai-catalog-chat',
      model: MODELS.smart,
      max_tokens: 2048,
      system: SYSTEM,
      messages,
      tools: [WEB_SEARCH_TOOL, MANAGE_TOOL],
      tool_choice: { type: 'auto' },
    });

    const reply =
      (typeof toolInput?.reply === 'string' && toolInput.reply.trim()
        ? toolInput.reply.trim()
        : text) || 'Fatto.';

    // product_id valido solo se è davvero un prodotto del venditore.
    const candidateId = toolInput?.product_id ?? focused?.id ?? null;
    const matched = candidateId ? products.find((p) => p.id === candidateId) ?? null : null;
    const patch =
      matched && toolInput?.patch && typeof toolInput.patch === 'object' ? toolInput.patch : {};

    return NextResponse.json({
      reply,
      productId: matched?.id ?? null,
      patch,
      product: matched ? snapshot(matched, categories) : null,
    });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-catalog-chat');
    return ApiErrors.internal('Errore AI.');
  }
});

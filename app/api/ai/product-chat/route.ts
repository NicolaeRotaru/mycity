import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';

/**
 * Assistente AI agentico per la scheda prodotto.
 *
 * Il seller chatta in italiano. L'assistente VEDE le foto del prodotto, può
 * CERCARE sul web (server tool web_search) per capire qual è il prodotto reale,
 * le specifiche tipiche o un prezzo equo, ragiona, risponde a domande e — quando
 * opportuno — chiama lo strumento "edit_product" per proporre le modifiche. Il
 * client applica il patch allo stato del form: l'utente rivede e salva
 * (human-in-the-loop, niente scrittura DB da qui).
 *
 * Esperti senior consultati:
 * - Prompt Engineer: "Foto + stato prodotto + conversazione sono DATO → vanno
 *   in `messages`, mai nel system. tool_choice auto = il modello sceglie se
 *   cercare, chattare o proporre modifiche."
 * - Finance: "Sonnet + web search costano: cap aggressivo e max_uses limitato."
 * - Security: "Solo seller approvati. Nessun campo libero finisce nel DB senza
 *   passare dalla validazione del form."
 */

export const runtime = 'nodejs';

// Istruzioni stabili → cacheabili. Foto, dati del prodotto e conversazione
// vanno in `messages` come DATO (confine netto = anti prompt-injection).
const SYSTEM = `Sei l'assistente di "MyCity Piacenza" che aiuta un venditore a costruire e correggere la scheda di un suo prodotto. Conversi in italiano, in modo caldo, concreto e onesto. Sei come un assistente Claude generale, ma specializzato su QUESTO prodotto.

Hai a disposizione:
- le foto reali del prodotto (quando presenti): guardale per capire di che oggetto si tratta;
- lo stato attuale della scheda (JSON), gli slug delle categorie disponibili e gli attributi validi per la categoria corrente;
- lo strumento "web_search" per cercare online: usalo quando devi identificare il prodotto reale, trovare specifiche/caratteristiche tipiche, un prezzo di mercato equo, o verificare un dato. Spesso il compilatore automatico sbaglia prodotto (stesso nome, azienda diversa): incrocia foto + ricerca per capire qual è davvero.

Come lavori:
- Puoi ragionare, fare domande, dare consigli e spiegare cosa vedi/trovi. Cita brevemente cosa hai scoperto online.
- Quando vuoi CAMBIARE uno o più campi della scheda, chiama SEMPRE lo strumento "edit_product" (non descrivere solo a parole le modifiche). Puoi accompagnarlo con un breve testo che spiega cosa hai cambiato e perché.
- Se la richiesta è ambigua o ti servono dettagli, NON modificare: chiedi chiarimenti a parole.

Regole per "edit_product":
- In "patch" inserisci SOLO i campi che cambiano rispetto allo stato attuale.
- Per TOGLIERE un valore: usa null per gli scalari (compare_at_price, condition) e "attributes_remove" per gli attributi.
- "tags" è la lista COMPLETA desiderata (ricostruiscila partendo da quella attuale per aggiungere o togliere).
- "attributes" usa SOLO le chiavi dell'elenco degli attributi validi e, per i campi a scelta, SOLO le opzioni elencate.
- "category_slug" deve essere uno degli slug forniti; "subcategory_name" è il nome della sottocategoria.
- Prezzi in euro come numero (es. 4.90). Niente emoji.`;

const EDIT_TOOL: Anthropic.Tool = {
  name: 'edit_product',
  description:
    'Risponde al venditore e propone le modifiche da applicare alla scheda prodotto.',
  input_schema: {
    type: 'object',
    properties: {
      reply: {
        type: 'string',
        description: 'Risposta conversazionale in italiano per il venditore.',
      },
      patch: {
        type: 'object',
        description: 'Solo i campi da cambiare. Ometti quelli invariati.',
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
          category_slug: {
            type: 'string',
            description: 'Slug della categoria di primo livello.',
          },
          subcategory_name: {
            type: 'string',
            description: 'Nome della sottocategoria (opzionale).',
          },
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
          status: {
            type: 'string',
            enum: ['available', 'draft', 'sold'],
          },
        },
      },
    },
    required: ['reply'],
  },
};

type ChatRole = 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

type AttributeSchemaField = {
  key: string;
  label?: string;
  type?: string;
  options?: string[];
};

type ProductSnapshot = Record<string, unknown>;

type ProductChatBody = {
  history?: ChatMessage[];
  product?: ProductSnapshot;
  attributeSchema?: AttributeSchemaField[];
  topCategories?: { name: string; slug: string }[];
  imageUrls?: string[];
};

/** Server tool gestito da Anthropic: esegue le ricerche dentro la stessa call. */
const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,
  user_location: { type: 'approximate', country: 'IT' },
};

const MAX_IMAGES = 4;

type EditProductInput = {
  reply?: string;
  patch?: Record<string, unknown>;
};

const MAX_HISTORY = 20; // ultimi N turni: limita costo e drift
const MAX_CONTENT = 2000; // cap per messaggio

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');

  // Rate limit: 25 messaggi / ora per utente (Sonnet + web search costano).
  const rl = rateLimit({ key: `ai-product-chat:${user.id}`, max: 25, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: ProductChatBody;
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

  // La conversazione deve iniziare con un turno utente per alternarsi col primer.
  while (history.length > 0 && history[0].role !== 'user') history.shift();
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return ApiErrors.invalidRequest('Scrivi un messaggio per l\'assistente.');
  }

  const product = body.product && typeof body.product === 'object' ? body.product : {};
  const attributeSchema = Array.isArray(body.attributeSchema) ? body.attributeSchema : [];
  const topCategories = Array.isArray(body.topCategories) ? body.topCategories : [];
  const imageUrls = (Array.isArray(body.imageUrls) ? body.imageUrls : [])
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, MAX_IMAGES);

  // Blocco-contesto come DATO (in `messages`), mai come istruzioni (system).
  const attrLines = attributeSchema
    .map((f) => {
      const opts = f.options && f.options.length ? ` [opzioni: ${f.options.join(', ')}]` : '';
      return `- ${f.key} (${f.type ?? 'text'})${opts}`;
    })
    .join('\n');
  const contextText = `${imageUrls.length ? 'Le immagini qui sopra sono le foto reali di questo prodotto: usale per identificarlo.\n\n' : ''}Stato attuale del prodotto (JSON):
${JSON.stringify(product, null, 2)}

Categorie di primo livello disponibili (slug):
${topCategories.map((c) => `- ${c.slug} (${c.name})`).join('\n') || '- (nessuna)'}

Attributi validi per la categoria attuale:
${attrLines || '- (nessuno)'}`;

  // Foto + testo come content block del primo messaggio utente.
  const contextContent: Anthropic.ContentBlockParam[] = [
    ...imageUrls.map(
      (url): Anthropic.ImageBlockParam => ({
        type: 'image',
        source: { type: 'url', url },
      }),
    ),
    { type: 'text', text: contextText },
  ];

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: contextContent },
    {
      role: 'assistant',
      content: 'Ricevuto, ho la scheda prodotto e le foto davanti. Dimmi cosa vuoi fare.',
    },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    const { text, toolInput } = await runMessage<EditProductInput>({
      feature: 'ai-product-chat',
      model: MODELS.smart,
      max_tokens: 2048,
      system: SYSTEM,
      messages,
      tools: [WEB_SEARCH_TOOL, EDIT_TOOL],
      tool_choice: { type: 'auto' },
    });

    // reply = prosa del modello; se ha solo chiamato il tool, usa il suo reply.
    const reply =
      text ||
      (typeof toolInput?.reply === 'string' && toolInput.reply.trim()
        ? toolInput.reply.trim()
        : 'Fatto.');
    const patch =
      toolInput?.patch && typeof toolInput.patch === 'object' ? toolInput.patch : {};

    return NextResponse.json({ reply, patch });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-product-chat');
    return ApiErrors.internal('Errore AI.');
  }
});

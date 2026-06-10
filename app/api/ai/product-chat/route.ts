import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';

/**
 * Assistente AI in chat per modificare la scheda prodotto.
 *
 * Il seller chatta in italiano ("metti il prezzo a 4,90", "aggiungi il tag
 * regalo", "togli la marca") e il modello restituisce un PATCH dei soli campi
 * da cambiare + una risposta conversazionale. Il client applica il patch allo
 * stato del form: l'utente rivede e salva (human-in-the-loop, niente scrittura
 * DB da qui).
 *
 * Esperti senior consultati:
 * - Prompt Engineer: "Lo stato del prodotto è DATO → va in `messages`, mai nel
 *   system. Tool forzato = output deterministico (reply + patch)."
 * - Finance: "Haiku per cost-efficacy, cap aggressivo per utente."
 * - Security: "Solo seller approvati. Nessun campo libero finisce nel DB senza
 *   passare dalla validazione del form."
 */

export const runtime = 'nodejs';

// Istruzioni stabili → cacheabili. I dati del prodotto e la conversazione
// vanno in `messages` come DATO (confine netto = anti prompt-injection).
const SYSTEM = `Sei l'assistente di "MyCity Piacenza" che aiuta un venditore a sistemare la scheda di un suo prodotto, conversando in italiano.

Hai sempre davanti lo stato attuale del prodotto (in formato JSON), gli slug delle categorie disponibili e l'elenco degli attributi validi per la categoria corrente. Usa SEMPRE lo strumento "edit_product".

Regole:
- In "patch" inserisci SOLO i campi che vanno cambiati rispetto allo stato attuale. Lascia fuori tutto il resto.
- Per TOGLIERE un valore: usa null per gli scalari (compare_at_price, condition) e "attributes_remove" per gli attributi.
- "tags" è la lista COMPLETA desiderata (ricostruiscila partendo da quella attuale per aggiungere o rimuovere).
- "attributes" imposta/aggiorna gli attributi indicati; usa SOLO le chiavi presenti nell'elenco degli attributi validi e, per i campi a scelta multipla, SOLO le opzioni elencate.
- "category_slug" deve essere uno degli slug forniti; "subcategory_name" è il nome della sottocategoria (verrà abbinato dal sistema).
- Prezzi in euro come numero (es. 4.90). Non inventare dati non richiesti.
- Se la richiesta è ambigua o servono dettagli, NON modificare nulla: lascia "patch" vuoto e fai una domanda di chiarimento in "reply".
- "reply" è sempre una risposta breve, calda e concreta in italiano che spiega cosa hai cambiato o cosa ti serve. Niente emoji.`;

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
};

type EditProductInput = {
  reply?: string;
  patch?: Record<string, unknown>;
};

const MAX_HISTORY = 20; // ultimi N turni: limita costo e drift
const MAX_CONTENT = 2000; // cap per messaggio

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');

  // Rate limit: 40 messaggi / ora per utente (chat multi-turno).
  const rl = rateLimit({ key: `ai-product-chat:${user.id}`, max: 40, windowMs: 60 * 60_000 });
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

  // Blocco-contesto come DATO (in `messages`), mai come istruzioni (system).
  const attrLines = attributeSchema
    .map((f) => {
      const opts = f.options && f.options.length ? ` [opzioni: ${f.options.join(', ')}]` : '';
      return `- ${f.key} (${f.type ?? 'text'})${opts}`;
    })
    .join('\n');
  const contextBlock = `Stato attuale del prodotto (JSON):
${JSON.stringify(product, null, 2)}

Categorie di primo livello disponibili (slug):
${topCategories.map((c) => `- ${c.slug} (${c.name})`).join('\n') || '- (nessuna)'}

Attributi validi per la categoria attuale:
${attrLines || '- (nessuno)'}`;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: contextBlock },
    {
      role: 'assistant',
      content: 'Ricevuto, ho la scheda prodotto davanti. Dimmi cosa vuoi modificare.',
    },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    const { toolInput } = await runMessage<EditProductInput>({
      feature: 'ai-product-chat',
      model: MODELS.fast,
      max_tokens: 700,
      system: SYSTEM,
      messages,
      tools: [EDIT_TOOL],
      tool_choice: { type: 'tool', name: 'edit_product' },
    });

    if (!toolInput) return ApiErrors.badGateway('Risposta AI inattesa. Riprova.');

    const reply =
      typeof toolInput.reply === 'string' && toolInput.reply.trim()
        ? toolInput.reply.trim()
        : 'Fatto.';
    const patch =
      toolInput.patch && typeof toolInput.patch === 'object' ? toolInput.patch : {};

    return NextResponse.json({ reply, patch });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-product-chat');
    return ApiErrors.internal('Errore AI.');
  }
});

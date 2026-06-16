import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { getAdminSupabase } from '@/lib/supabase/server';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';
import { PRODUCT_PATCH_PROPERTIES } from '@/lib/ai/patchSchema';
import { productSnapshot, PRODUCT_SNAPSHOT_COLS, type ProductRow } from '@/lib/products/aiSnapshot';
import type { AiProductPatch, CategoryRow } from '@/lib/products/aiPatch';

/**
 * Copilot del negozio — modifiche di massa in linguaggio naturale.
 *
 * Il venditore scrive un'istruzione sull'INTERO catalogo ("abbassa del 10%
 * l'elettronica", "metti in bozza gli esauriti", "aggiungi il tag saldi a tutto
 * l'abbigliamento") e il copilot — che vede il catalogo come DATO — propone la
 * lista di modifiche (product_id + patch) per i prodotti coinvolti. NON applica:
 * la UI mostra il piano e applica via /api/ai/catalog-apply (human-in-the-loop).
 *
 * Riusa il pattern di catalog-chat (catalogo filtrato per seller come DATO,
 * istruzioni cacheabili nel system) ma restituisce PIÙ modifiche insieme.
 */

export const runtime = 'nodejs';

const SYSTEM = `Sei il copilot del negozio su "MyCity Piacenza". Il venditore ti dà un'istruzione che riguarda PIÙ prodotti del suo catalogo e tu proponi le modifiche, in italiano.

Hai l'elenco dei suoi prodotti (id, nome, prezzo, stato, categoria, stock). In base all'istruzione:
- Individua i prodotti coinvolti (per categoria, stato, nome, ecc.).
- Per ognuno costruisci una voce in "changes" con il suo "product_id" (preso ESATTAMENTE dall'elenco) e un "patch" con SOLO i campi da cambiare.
- Per le variazioni di prezzo calcola TU il nuovo prezzo numerico per ciascun prodotto (es. -10% su €20 → 18.0), non scrivere percentuali.
- "tags" è la lista COMPLETA desiderata del prodotto (ricostruiscila da quella attuale per aggiungere/togliere).
- Usa "status" tra: available, draft, sold.
- Se l'istruzione è ambigua o pericolosa (es. "cancella tutto"), NON proporre modifiche: spiega e chiedi conferma in "reply".
- Non inventare prodotti non in elenco. Niente emoji.

Metti nel campo "reply" un riepilogo conciso ("Ho preparato N modifiche: …"). Chiama sempre e solo lo strumento "bulk_edit".`;

const TOOL: Anthropic.Tool = {
  name: 'bulk_edit',
  description: 'Propone le modifiche di massa per i prodotti coinvolti dall\'istruzione.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'Riepilogo in italiano di cosa hai preparato.' },
      changes: {
        type: 'array',
        description: 'Una voce per prodotto da modificare.',
        items: {
          type: 'object',
          properties: {
            product_id: { type: 'string', description: 'ID preso dall\'elenco del catalogo.' },
            patch: { type: 'object', properties: PRODUCT_PATCH_PROPERTIES },
          },
          required: ['product_id', 'patch'],
        },
      },
    },
    required: ['reply'],
  },
};

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Body = { instruction?: string; history?: ChatMessage[] };
type BulkInput = { reply?: string; changes?: { product_id?: string; patch?: AiProductPatch }[] };

const MAX_CATALOG = 200;
const MAX_CHANGES = 200;

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');
  const rl = rateLimit({ key: `ai-copilot:${user.id}`, max: 25, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 1000) : '';
  if (!instruction) return ApiErrors.invalidRequest('Scrivi un\'istruzione per il copilot.');

  const admin = getAdminSupabase();
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
  if (products.length === 0) {
    return NextResponse.json({ reply: 'Non hai ancora prodotti nel catalogo.', changes: [] });
  }

  const list = products
    .map((p) => {
      const s = productSnapshot(p, categories);
      return `- id=${s.id} · ${s.name} · ${s.price != null ? `€${s.price}` : 's.p.'} · ${s.status} · ${s.categoryName ?? '—'} · stock ${s.stock ?? '∞'}`;
    })
    .join('\n');

  const contextText = `Catalogo del venditore (${products.length} prodotti):
${list}

Istruzione del venditore: "${instruction}"

Proponi le modifiche con lo strumento bulk_edit.`;

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m): m is ChatMessage => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: contextText },
    ...history,
  ];

  try {
    const { toolInput } = await runMessage<BulkInput>({
      feature: 'ai-copilot',
      model: MODELS.smart,
      max_tokens: 4096,
      system: SYSTEM,
      messages,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'bulk_edit' },
    });

    // Valida: solo product_id realmente del venditore e patch non vuoti.
    const owned = new Set(products.map((p) => p.id));
    const changes = (Array.isArray(toolInput?.changes) ? toolInput!.changes! : [])
      .filter((c): c is { product_id: string; patch: AiProductPatch } =>
        !!c && typeof c.product_id === 'string' && owned.has(c.product_id) &&
        !!c.patch && typeof c.patch === 'object' && Object.keys(c.patch).length > 0)
      .slice(0, MAX_CHANGES)
      .map((c) => {
        const snap = productSnapshot(products.find((p) => p.id === c.product_id)!, categories);
        return { product_id: c.product_id, name: snap.name, patch: c.patch };
      });

    return NextResponse.json({
      reply: typeof toolInput?.reply === 'string' ? toolInput.reply : '',
      changes,
    });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-copilot');
    return ApiErrors.internal('Errore AI.');
  }
});

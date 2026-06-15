// lib/ai/catalogBatch.ts
import type Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/ai/client';
import type { BatchRequest, BatchResultEntry } from '@/lib/ai/batch';
import { PRODUCT_PATCH_PROPERTIES } from '@/lib/ai/patchSchema';
import { productSnapshot, type ProductRow } from '@/lib/products/aiSnapshot';
import { getAttributesForCategory } from '@/lib/category-attributes';
import type { AiProductPatch, CategoryRow } from '@/lib/products/aiPatch';

/**
 * Costruzione e parsing delle richieste per i job AI massivi sul catalogo
 * (Message Batches API). Sorgente unica e testabile: una richiesta per prodotto
 * con system+tool specifici dell'operazione, e parsing dei risultati in un
 * formato uniforme. Niente immagini né web_search nel batch (costo/affidabilità):
 * il batch lavora sul testo della scheda.
 */

export const CATALOG_OPERATIONS = ['improve', 'redescribe', 'moderate', 'translate'] as const;
export type CatalogOperation = (typeof CATALOG_OPERATIONS)[number];

export function isCatalogOperation(v: unknown): v is CatalogOperation {
  return typeof v === 'string' && (CATALOG_OPERATIONS as readonly string[]).includes(v);
}

/** Risultato uniforme per prodotto dopo il parsing del batch. */
export type CatalogJobResult = {
  product_id: string;
  patch?: AiProductPatch;
  summary?: string;
  flagged?: boolean;
  reason?: string;
  error?: string;
};

const LANGS: Record<string, string> = {
  en: 'inglese', fr: 'francese', de: 'tedesco', es: 'spagnolo', ro: 'rumeno', ar: 'arabo', zh: 'cinese',
};

export function isSupportedLang(code: unknown): code is string {
  return typeof code === 'string' && code in LANGS;
}

const PATCH_TOOL = (name: string, description: string, props: Record<string, unknown>): Anthropic.Tool => ({
  name,
  description,
  input_schema: { type: 'object', properties: props, required: [] },
});

/** System + tool + max_tokens per ciascuna operazione. */
function opSpec(operation: CatalogOperation, langName?: string): {
  system: string;
  tool: Anthropic.Tool;
  maxTokens: number;
  withSchema: boolean;
} {
  switch (operation) {
    case 'improve':
      return {
        withSchema: true,
        maxTokens: 1024,
        system: `Sei un esperto di e-commerce per "MyCity Piacenza". Migliora la scheda di UN prodotto (nome, descrizione, tag, attributi mancanti, categoria se sbagliata) in modo onesto, senza inventare. In "patch" metti SOLO i campi da cambiare; ometti gli invariati. "tags" è la lista completa. Niente emoji. Rispondi solo con lo strumento "improve_one".`,
        tool: PATCH_TOOL('improve_one', 'Migliora la scheda prodotto.', {
          summary: { type: 'string', description: 'Cosa hai migliorato, 1 frase.' },
          patch: { type: 'object', properties: PRODUCT_PATCH_PROPERTIES },
        }),
      };
    case 'redescribe':
      return {
        withSchema: false,
        maxTokens: 512,
        system: `Sei un copywriter per "MyCity Piacenza". Riscrivi SOLO la descrizione di un prodotto in italiano: calda, onesta, scannerizzabile, 250-500 caratteri, basata sui dati esistenti (non inventare). Rispondi solo con lo strumento "redescribe_one".`,
        tool: PATCH_TOOL('redescribe_one', 'Riscrive la descrizione.', {
          patch: { type: 'object', properties: { description: { type: 'string' } } },
        }),
      };
    case 'moderate':
      return {
        withSchema: false,
        maxTokens: 256,
        system: `Sei il responsabile conformità di "MyCity Piacenza". Valuta se un prodotto è AMMESSO sul marketplace (vietati: armi, droga, contraffazione, contenuti per adulti, animali vivi, farmaci da prescrizione). In caso di dubbio, flagged=true. Rispondi solo con lo strumento "moderate_one".`,
        tool: PATCH_TOOL('moderate_one', 'Classifica la conformità del prodotto.', {
          flagged: { type: 'boolean', description: 'true se NON ammesso o dubbio.' },
          reason: { type: 'string', description: 'Motivo breve se flagged.' },
        }),
      };
    case 'translate':
      return {
        withSchema: false,
        maxTokens: 768,
        system: `Sei un traduttore professionista per "MyCity Piacenza". Traduci nome, descrizione e tag del prodotto in ${langName ?? 'inglese'}, in modo fedele e naturale. Non aggiungere né inventare. I tag sono parole chiave minuscole nella lingua di destinazione. Rispondi solo con lo strumento "translate_one".`,
        tool: PATCH_TOOL('translate_one', 'Traduce la scheda.', {
          patch: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
            },
          },
        }),
      };
  }
}

/** Testo-scheda (DATO) per un prodotto, con eventuali categorie/attributi. */
function productText(row: ProductRow, categories: CategoryRow[], withSchema: boolean): string {
  const snap = productSnapshot(row, categories);
  const parts = [`Scheda prodotto (JSON):\n${JSON.stringify(snap, null, 2)}`];
  if (withSchema) {
    const top = categories.filter((c) => !c.parent_id);
    parts.push(
      `Categorie di primo livello (slug):\n${top.map((c) => `- ${c.slug} (${c.name})`).join('\n')}`,
    );
    const { fields } = getAttributesForCategory(
      categories.map((c) => ({ id: c.id, slug: c.slug, parent_id: c.parent_id })),
      row.category_id,
    );
    if (fields.length) {
      parts.push(
        `Attributi validi per la categoria:\n${fields
          .map((f) => `- ${f.key} (${f.type})${f.options?.length ? ` [opzioni: ${f.options.join(', ')}]` : ''}`)
          .join('\n')}`,
      );
    }
  }
  return parts.join('\n\n');
}

/**
 * Costruisce una BatchRequest per ogni prodotto. custom_id = product.id (gli
 * UUID rispettano il pattern richiesto dalla Batch API).
 */
export function buildCatalogBatchRequests(opts: {
  operation: CatalogOperation;
  products: ProductRow[];
  categories: CategoryRow[];
  targetLang?: string;
}): BatchRequest[] {
  const langName = opts.operation === 'translate' ? LANGS[opts.targetLang ?? ''] ?? 'inglese' : undefined;
  const spec = opSpec(opts.operation, langName);
  return opts.products.map((p) => ({
    custom_id: p.id,
    model: MODELS.fast, // batch su tutto il catalogo: modello economico
    max_tokens: spec.maxTokens,
    system: spec.system,
    messages: [{ role: 'user', content: productText(p, opts.categories, spec.withSchema) }],
    tools: [spec.tool],
    tool_choice: { type: 'tool', name: spec.tool.name },
  }));
}

/** Parsa una entry di risultato batch nel formato uniforme. */
export function parseCatalogBatchEntry(
  operation: CatalogOperation,
  entry: BatchResultEntry,
): CatalogJobResult {
  const productId = entry.customId;
  if (entry.status !== 'succeeded') {
    return { product_id: productId, error: entry.errorType ?? entry.status };
  }
  const input = (entry.toolInput ?? {}) as Record<string, unknown>;
  if (operation === 'moderate') {
    return {
      product_id: productId,
      flagged: input.flagged === true,
      reason: typeof input.reason === 'string' ? input.reason : undefined,
    };
  }
  const patch = input.patch && typeof input.patch === 'object' ? (input.patch as AiProductPatch) : {};
  return {
    product_id: productId,
    patch,
    summary: typeof input.summary === 'string' ? input.summary : undefined,
  };
}

export function langName(code: string | null | undefined): string | undefined {
  return code ? LANGS[code] : undefined;
}

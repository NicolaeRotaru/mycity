// lib/ai/productContext.ts
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Costruisce il blocco-contesto del prodotto come DATO (foto + scheda JSON +
 * categorie + attributi) da mettere in `messages`, mai nel system (confine netto
 * = difesa anti prompt-injection). Sorgente unica riusata dalle route AI che
 * operano su un singolo prodotto (seo, diagnose, translate, …).
 */

export type AttributeSchemaField = { key: string; label?: string; type?: string; options?: string[] };

export type ProductContextInput = {
  product: Record<string, unknown>;
  attributeSchema?: AttributeSchemaField[];
  topCategories?: { name: string; slug: string }[];
  imageUrls?: string[];
};

const DEFAULT_MAX_IMAGES = 4;

/** Filtra e limita gli URL immagine ammessi (http/https). */
export function sanitizeImageUrls(urls: unknown, max = DEFAULT_MAX_IMAGES): string[] {
  return (Array.isArray(urls) ? urls : [])
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, max);
}

export function buildProductContext(
  input: ProductContextInput,
  opts: { maxImages?: number; lead?: string } = {},
): Anthropic.ContentBlockParam[] {
  const imageUrls = sanitizeImageUrls(input.imageUrls, opts.maxImages ?? DEFAULT_MAX_IMAGES);
  const attributeSchema = Array.isArray(input.attributeSchema) ? input.attributeSchema : [];
  const topCategories = Array.isArray(input.topCategories) ? input.topCategories : [];

  const attrLines = attributeSchema
    .map((f) => {
      const opts2 = f.options && f.options.length ? ` [opzioni: ${f.options.join(', ')}]` : '';
      return `- ${f.key} (${f.type ?? 'text'})${opts2}`;
    })
    .join('\n');

  const parts: string[] = [];
  if (opts.lead) parts.push(opts.lead);
  if (imageUrls.length) parts.push('Le immagini qui sopra sono le foto reali di questo prodotto.');
  parts.push(`Stato attuale del prodotto (JSON):\n${JSON.stringify(input.product, null, 2)}`);
  if (topCategories.length) {
    parts.push(
      `Categorie di primo livello disponibili (slug):\n${topCategories
        .map((c) => `- ${c.slug} (${c.name})`)
        .join('\n')}`,
    );
  }
  if (attributeSchema.length) {
    parts.push(`Attributi validi per la categoria attuale:\n${attrLines}`);
  }

  return [
    ...imageUrls.map(
      (url): Anthropic.ImageBlockParam => ({ type: 'image', source: { type: 'url', url } }),
    ),
    { type: 'text', text: parts.join('\n\n') },
  ];
}

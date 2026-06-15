// lib/ai/patchSchema.ts

/**
 * Proprietà JSON-schema del "patch prodotto" proposto dall'AI — gemello di
 * AiProductPatch (lib/products/aiPatch) lato tool. Sorgente unica riusata dai
 * tool delle route AI (seo, diagnose, translate, …) così lo schema resta
 * identico e applicabile dallo stesso resolver/applyPatch.
 */
export const PRODUCT_PATCH_PROPERTIES: Record<string, unknown> = {
  name: { type: 'string' },
  description: { type: 'string' },
  price: { type: 'number', description: 'Prezzo di vendita in euro.' },
  compare_at_price: {
    type: ['number', 'null'],
    description: 'Prezzo pieno barrato in euro. null per rimuoverlo.',
  },
  unit: { type: 'string', enum: ['pezzo', 'kg', 'g', 'l', 'ml', 'confezione', 'paio', 'm'] },
  condition: {
    type: ['string', 'null'],
    enum: ['nuovo', 'usato', 'ricondizionato', null],
    description: 'null per "non specificata".',
  },
  stock: { type: 'number', description: 'Disponibilità in pezzi.' },
  unlimited_stock: { type: 'boolean', description: 'true per disponibilità illimitata.' },
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
};

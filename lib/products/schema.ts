import * as z from 'zod';

/**
 * Schema e modello condivisi del form prodotto (nuovo + modifica).
 *
 * I campi testo/numero passano da react-hook-form (validati qui via zod).
 * I campi "ricchi" (immagini, attributi, tag, unità, condizione, Express,
 * stock illimitato) restano stato del componente e confluiscono nel payload
 * tramite `buildProductPayload`. Lo schema è anche la base della validazione
 * lato server (affiancata dai CHECK di migrations/071).
 */

export const PRODUCT_UNITS = ['pezzo', 'kg', 'g', 'l', 'ml', 'confezione', 'paio', 'm'] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

/** Etichette per la <select> "unità di prezzo". */
export const UNIT_OPTIONS: { value: ProductUnit; label: string }[] = [
  { value: 'pezzo', label: '€ / pezzo' },
  { value: 'kg', label: '€ / kg' },
  { value: 'g', label: '€ / 100 g' },
  { value: 'l', label: '€ / litro' },
  { value: 'ml', label: '€ / 100 ml' },
  { value: 'confezione', label: '€ / confezione' },
  { value: 'paio', label: '€ / paio' },
  { value: 'm', label: '€ / metro' },
];

/** Suffisso compatto per l'anteprima prezzo (es. "€12,00/kg"). */
export const UNIT_SUFFIX: Record<ProductUnit, string> = {
  pezzo: '',
  kg: '/kg',
  g: '/100g',
  l: '/L',
  ml: '/100ml',
  confezione: '/conf.',
  paio: '/paio',
  m: '/m',
};

export const PRODUCT_CONDITIONS = ['nuovo', 'usato', 'ricondizionato'] as const;
export type ProductCondition = (typeof PRODUCT_CONDITIONS)[number];
export const CONDITION_LABELS: Record<ProductCondition, string> = {
  nuovo: 'Nuovo',
  usato: 'Usato',
  ricondizionato: 'Ricondizionato',
};

/**
 * Normalizza testo libero (AI o vecchio attributo per-categoria `stato`) nella
 * condizione standardizzata. '' se non riconosciuta.
 */
export function normalizeCondition(s: string): ProductCondition | '' {
  const t = s.toLowerCase();
  if (t.includes('ricond')) return 'ricondizionato';
  if (t.includes('usat')) return 'usato';
  if (t.includes('nuov')) return 'nuovo';
  return '';
}

/** Stati prodotto gestiti dall'interfaccia venditore. */
export const SELLER_STATUSES = ['available', 'draft', 'sold'] as const;
export type SellerStatus = (typeof SELLER_STATUSES)[number];

/**
 * Schema dei campi RHF. `minDescription` differisce tra creazione (30, gate
 * qualità) e modifica (10, non bloccare annunci storici brevi).
 */
export function createProductSchema(opts?: { minDescription?: number }) {
  const minDesc = opts?.minDescription ?? 10;
  return z
    .object({
      name: z.string().min(3, 'Almeno 3 caratteri'),
      description: z
        .string()
        .min(
          minDesc,
          minDesc >= 30
            ? 'Descrivi bene il prodotto: almeno 30 caratteri (materiali, taglia, condizione…)'
            : `Almeno ${minDesc} caratteri`,
        ),
      price: z.coerce.number().positive('Inserisci un prezzo valido'),
      // Prezzo pieno barrato: opzionale. Stringa vuota → undefined.
      compareAtPrice: z.preprocess(
        (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
        z.number().positive('Inserisci un importo valido').optional(),
      ),
      // Disabilitato quando "illimitato" è attivo → RHF lo esclude (undefined).
      stock: z.coerce.number().int('Numero intero').min(0, 'Non può essere negativo').optional(),
      category_id: z.string().min(1, 'Seleziona una categoria'),
    })
    .refine(
      (d) => d.compareAtPrice == null || d.compareAtPrice > d.price,
      { path: ['compareAtPrice'], message: 'Il prezzo pieno deve superare il prezzo di vendita' },
    );
}

export type ProductFormValues = z.infer<ReturnType<typeof createProductSchema>>;

export interface BuildPayloadInput {
  values: ProductFormValues;
  imageUrls: string[];
  attributes: Record<string, unknown>;
  unit: ProductUnit;
  condition: ProductCondition | '';
  tags: string[];
  expressEnabled: boolean | null;
  unlimitedStock: boolean;
  status: string;
}

/** Costruisce il payload DB (senza seller_id) da valori RHF + stato del form. */
export function buildProductPayload(input: BuildPayloadInput) {
  const { values, imageUrls, attributes, unit, condition, tags, expressEnabled, unlimitedStock, status } = input;
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    price: values.price,
    compare_at_price:
      values.compareAtPrice != null && !Number.isNaN(values.compareAtPrice) ? values.compareAtPrice : null,
    unit,
    condition: condition || null,
    stock: unlimitedStock ? null : values.stock ?? 0,
    category_id: values.category_id,
    images: imageUrls,
    attributes,
    tags,
    express_enabled: expressEnabled,
    status,
  };
}

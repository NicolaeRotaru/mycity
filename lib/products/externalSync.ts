import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/ai/client';
import { runMessage } from '@/lib/ai/run';
import { getAdminSupabase } from '@/lib/supabase/server';
import { CATEGORY_ATTRIBUTES } from '@/lib/category-attributes';
import {
  type Marketplace,
  type ExternalData,
  type Availability,
  num,
  deliveryLabelFrom,
  normalizeLabel,
} from '@/lib/products/externalSyncShared';

/**
 * Import e sincronizzazione di prodotti da marketplace esterni (Amazon/eBay/…).
 *
 * Fonte dati: Claude + web_search (stessa infrastruttura di
 * `app/api/vision/extract-product`). Dato un URL o un nome prodotto, il modello
 * cerca l'annuncio reale e riporta dati identici, incluso il tempo di consegna
 * indicato sul marketplace. Lo snapshot viene salvato su `products.external_*`
 * e rinfrescato in background con TTL quando il cliente vede il prodotto.
 *
 * La logica pura (TTL, staleness, normalizzazione) vive in `externalSyncShared`.
 */

// Re-export per non rompere gli import esistenti.
export { MARKETPLACES, EXTERNAL_TTL_MS, isStale, normalizeLabel } from '@/lib/products/externalSyncShared';
export type { Marketplace, ExternalData, Availability } from '@/lib/products/externalSyncShared';

const CATEGORY_SLUGS = [
  'alimentari', 'abbigliamento', 'casa', 'elettronica', 'libri', 'giardino', 'bellezza', 'sport',
] as const;

/** Risultato completo dell'import (campi prodotto + blocco esterno). */
export type MarketplaceExtract = {
  name: string;
  description: string;
  category_slug: string;
  subcategory: string | null;
  price: number | null;
  currency: string | null;
  image_urls: string[];
  attributes: Record<string, string>;
  tags: string[];
  external: ExternalData;
  marketplace: Marketplace | null;
  source_url: string | null;
  confidence: number | null;
};

type ToolInput = {
  name?: string;
  description?: string;
  category_slug?: string;
  subcategory?: string;
  price_eur?: number;
  currency?: string;
  image_urls?: string[];
  attributes?: Record<string, string>;
  tags?: string[];
  delivery_min_days?: number;
  delivery_max_days?: number;
  delivery_label?: string;
  availability?: string;
  source_title?: string;
  source_url?: string;
  confidence?: number;
};

// Riferimento chiavi attributo per categoria (come in vision/extract-product):
// il modello compila gli stessi campi del form usando le chiavi/valori ammessi.
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

const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,
  user_location: { type: 'approximate', country: 'IT' },
};

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'extract_marketplace_product',
  description:
    'Riporta i dati di un prodotto trovato su un marketplace (Amazon/eBay/AliExpress) a partire dal suo URL o nome. Usa SEMPRE questo tool, mai testo libero.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nome del prodotto in italiano, fedele all\'annuncio (3-80 caratteri).' },
      description: { type: 'string', description: 'Descrizione in italiano (30-600 caratteri) basata sull\'annuncio reale.' },
      category_slug: {
        type: 'string', enum: [...CATEGORY_SLUGS],
        description: 'Categoria del marketplace MyCity più adatta. Esattamente una di: alimentari, abbigliamento, casa, elettronica, libri, giardino, bellezza, sport.',
      },
      subcategory: { type: 'string', description: 'Nome della sottocategoria più adatta, in italiano. Vuoto se incerto.' },
      price_eur: { type: 'number', description: 'Prezzo attuale dell\'annuncio in euro (converti se in altra valuta). Numero positivo, max 2 decimali.' },
      currency: { type: 'string', description: 'Valuta originale dell\'annuncio (es. EUR, USD).' },
      image_urls: {
        type: 'array', items: { type: 'string' },
        description: 'Fino a 6 URL assoluti delle immagini del prodotto dall\'annuncio (https://…).',
      },
      attributes: {
        type: 'object', additionalProperties: { type: 'string' },
        description: 'Caratteristiche come coppie chiave→valore. DOPO category_slug usa ESCLUSIVAMENTE le chiavi previste per quella categoria (vedi prompt). Per i select scegli esattamente un valore ammesso; per i sì/no usa "true"/"false". Ometti ciò che non è ricavabile.',
      },
      tags: { type: 'array', items: { type: 'string' }, description: '3-8 parole chiave brevi in italiano (lowercase) per la ricerca.' },
      delivery_min_days: { type: 'number', description: 'Giorni minimi di consegna indicati sul marketplace (intero).' },
      delivery_max_days: { type: 'number', description: 'Giorni massimi di consegna indicati sul marketplace (intero).' },
      delivery_label: { type: 'string', description: 'Etichetta consegna leggibile, es. "2-5 giorni", "Consegna in 1-2 giorni".' },
      availability: { type: 'string', enum: ['in_stock', 'out_of_stock', 'unknown'], description: 'Disponibilità sull\'annuncio.' },
      source_title: { type: 'string', description: 'Titolo originale dell\'annuncio sul marketplace.' },
      source_url: { type: 'string', description: 'URL canonico dell\'annuncio trovato.' },
      confidence: { type: 'number', description: 'Quanto sei sicuro che i dati corrispondano all\'annuncio reale (0-1).' },
    },
    required: ['name', 'description', 'category_slug', 'availability'],
  },
};

function buildPrompt(query: string, marketplace?: Marketplace): string {
  const mk = marketplace && marketplace !== 'other' ? ` (marketplace: ${marketplace})` : '';
  return `Sei un assistente del marketplace locale italiano MyCity. L'admin vuole ricreare nel nostro catalogo un prodotto in vendita su un marketplace esterno${mk}.

Input dell'admin (URL o nome del prodotto):
"""${query}"""

Compito:
- Usa lo strumento web_search per TROVARE l'annuncio reale corrispondente e leggerne i dati ESATTI: nome, descrizione, prezzo attuale, immagini, caratteristiche e soprattutto il TEMPO DI CONSEGNA indicato (giorni min/max ed etichetta).
- Riporta i dati FEDELI all'annuncio, in italiano. Converti il prezzo in euro se necessario (currency = valuta originale).
- Scegli category_slug in base alla funzione reale dell'oggetto e compila attributes con le SOLE chiavi della categoria scelta.
- Se non trovi un tempo di consegna esplicito, stima in modo prudente in base al marketplace e segnala availability="unknown" se non è chiara la disponibilità.
- Imposta confidence in modo onesto.
- Richiama SEMPRE extract_marketplace_product con i dati finali.

Attributi per categoria (usa SOLO le chiavi della categoria scelta; per i campi "uno tra" scegli esattamente uno dei valori elencati):
${ATTR_REFERENCE}`;
}

function toExternalData(input: ToolInput): ExternalData {
  const availability: Availability =
    input.availability === 'in_stock' || input.availability === 'out_of_stock' ? input.availability : 'unknown';
  return {
    price: num(input.price_eur),
    currency: typeof input.currency === 'string' ? input.currency.trim().toUpperCase().slice(0, 8) || null : null,
    delivery_min_days: num(input.delivery_min_days),
    delivery_max_days: num(input.delivery_max_days),
    delivery_label: deliveryLabelFrom(input),
    availability,
    source_title: typeof input.source_title === 'string' ? input.source_title.trim() || null : null,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Interroga Claude + web_search e restituisce i dati normalizzati dell'annuncio.
 * Può lanciare AiConfigError / AiCallError (gestiti dal chiamante).
 */
export async function fetchExternalSnapshot(query: string, marketplace?: Marketplace): Promise<MarketplaceExtract> {
  const result = await runMessage<ToolInput>({
    feature: 'marketplace-import',
    model: MODELS.smart,
    max_tokens: 1500,
    tools: [WEB_SEARCH_TOOL, EXTRACT_TOOL],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: [{ type: 'text', text: buildPrompt(query, marketplace) }] }],
  });

  const input = result.toolInput ?? {};

  const attributes: Record<string, string> = {};
  if (input.attributes && typeof input.attributes === 'object') {
    for (const [k, v] of Object.entries(input.attributes)) {
      if (typeof v === 'string' && v.trim()) attributes[k] = v.trim();
    }
  }

  const tags: string[] = [];
  if (Array.isArray(input.tags)) {
    for (const raw of input.tags) {
      if (typeof raw !== 'string') continue;
      const t = raw.trim().toLowerCase().replace(/,+$/, '');
      if (t && t.length <= 30 && !tags.includes(t)) tags.push(t);
      if (tags.length >= 8) break;
    }
  }

  const imageUrls: string[] = [];
  if (Array.isArray(input.image_urls)) {
    for (const raw of input.image_urls) {
      if (typeof raw === 'string' && /^https?:\/\//i.test(raw.trim()) && !imageUrls.includes(raw.trim())) {
        imageUrls.push(raw.trim());
      }
      if (imageUrls.length >= 6) break;
    }
  }

  return {
    name: (input.name ?? '').trim(),
    description: (input.description ?? '').trim(),
    category_slug: input.category_slug ?? '',
    subcategory: typeof input.subcategory === 'string' ? input.subcategory.trim() || null : null,
    price: num(input.price_eur),
    currency: typeof input.currency === 'string' ? input.currency.trim().toUpperCase().slice(0, 8) || null : null,
    image_urls: imageUrls,
    attributes,
    tags,
    external: toExternalData(input),
    marketplace: marketplace ?? null,
    source_url: typeof input.source_url === 'string' ? input.source_url.trim() || null : null,
    confidence: num(input.confidence),
  };
}

/** Risolve slug categoria (+ sottocategoria libera) → id, come la vision route. */
export async function resolveCategoryFromSlug(
  slug: string,
  subcategory?: string | null,
): Promise<{ categoryId: string | null; subcategoryId: string | null }> {
  if (!slug) return { categoryId: null, subcategoryId: null };
  try {
    const supa = getAdminSupabase();
    const { data: top } = await supa
      .from('categories')
      .select('id')
      .eq('slug', slug)
      .is('parent_id', null)
      .single();
    const categoryId = (top as { id?: string } | null)?.id ?? null;

    let subcategoryId: string | null = null;
    const wanted = subcategory ? normalizeLabel(subcategory) : '';
    if (categoryId && wanted) {
      const { data: subs } = await supa.from('categories').select('id, name, slug').eq('parent_id', categoryId);
      const match = (subs ?? []).find((s: { name?: string; slug?: string }) => {
        const name = normalizeLabel(s.name ?? '');
        const sl = normalizeLabel((s.slug ?? '').replace(/-/g, ' '));
        return name === wanted || sl === wanted || name.includes(wanted) || wanted.includes(name);
      });
      subcategoryId = (match as { id?: string } | undefined)?.id ?? null;
    }
    return { categoryId, subcategoryId };
  } catch {
    return { categoryId: null, subcategoryId: null };
  }
}

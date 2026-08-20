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

/**
 * #205 — Gli host da cui accettiamo una foto, gli stessi dichiarati in
 * next.config.js. Prima bastava che l'indirizzo cominciasse per http: un
 * venditore poteva far scaricare al modello — e poi mettere in vetrina — una
 * foto ospitata su un sito qualunque, che quel sito può cambiare quando vuole
 * (anche in qualcosa che non vorremmo mostrare), e che intanto vede il traffico
 * dei nostri clienti.
 */
const HOST_FOTO_AMMESSI = [
  /\.supabase\.co$/i,
  /^placehold\.co$/i,
  /^images\.pexels\.com$/i,
];

/** L'indirizzo è una foto ospitata da noi (o da un host dichiarato)? */
export function fotoDaHostAmmesso(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return HOST_FOTO_AMMESSI.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** Filtra e limita gli URL immagine ammessi (host dichiarati, http/https). */
export function sanitizeImageUrls(urls: unknown, max = DEFAULT_MAX_IMAGES): string[] {
  return (Array.isArray(urls) ? urls : [])
    .filter((u): u is string => typeof u === 'string' && fotoDaHostAmmesso(u))
    .slice(0, max);
}

export function buildProductContext(
  input: ProductContextInput,
  opts: { maxImages?: number; lead?: string } = {},
): Anthropic.ContentBlockParam[] {
  const imageUrls = sanitizeImageUrls(input.imageUrls, opts.maxImages ?? DEFAULT_MAX_IMAGES);
  // #201 — I tagli. Questi due elenchi arrivano dal client e finivano interi
  // dentro il prompt: un elenco gonfiato apposta faceva pagare a noi la
  // differenza, e spingeva fuori dalla finestra il contenuto che conta.
  const attributeSchema = (Array.isArray(input.attributeSchema) ? input.attributeSchema : []).slice(0, 40);
  const topCategories = (Array.isArray(input.topCategories) ? input.topCategories : []).slice(0, 30);

  const attrLines = attributeSchema
    .map((f) => {
      const opts2 = f.options && f.options.length ? ` [opzioni: ${f.options.join(', ')}]` : '';
      return `- ${f.key} (${f.type ?? 'text'})${opts2}`;
    })
    .join('\n');

  const parts: string[] = [];
  if (opts.lead) parts.push(opts.lead);
  if (imageUrls.length) parts.push('Le immagini qui sopra sono le foto reali di questo prodotto.');
  // 🟠-16: cap della serializzazione per evitare un blow-up di token (costo) se
  // il prodotto ha campi molto grandi (descrizioni lunghe, molte varianti).
  const productJson = JSON.stringify(input.product, null, 2);
  const MAX_PRODUCT_JSON = 4000;
  const cappedProductJson =
    productJson.length > MAX_PRODUCT_JSON
      ? `${productJson.slice(0, MAX_PRODUCT_JSON)}\n…(troncato per limite di lunghezza)`
      : productJson;
  parts.push(`Stato attuale del prodotto (JSON):\n${cappedProductJson}`);
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

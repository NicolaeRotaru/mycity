// lib/ai/productContext.ts
import type Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';
import { recinta } from '@/lib/ai/recinto';

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
/**
 * 27/8/2026 (R147) — «FOTO OSPITATE DA NOI» ERA «QUALUNQUE PROGETTO SUPABASE
 * DEL MONDO».
 *
 * La prima regola dell'elenco era `/\.supabase\.co$/i`: accettava il
 * sottodominio di qualsiasi progetto Supabase, e un progetto Supabase lo apre
 * chiunque, gratis, in due minuti. Il commento prometteva «foto ospitate da
 * noi» e il codice non lo faceva: bastava ospitare la foto altrove per
 * riportare dentro un'immagine che possiamo far scaricare al modello e che chi
 * la ospita puo' cambiare dopo.
 *
 * Adesso il confronto e' con l'host del NOSTRO progetto, ricavato dalla
 * variabile con cui il sito parla col database. Se quella variabile manca —
 * cosa che in produzione non succede, perche' senza il sito non parte — resta
 * il vecchio comportamento: meglio un filtro largo che le foto dei prodotti
 * che spariscono da tutte le schede.
 */
const HOST_ESTERNI_DICHIARATI = [/^placehold\.co$/i, /^images\.pexels\.com$/i];
const JOLLY_SUPABASE = /\.supabase\.co$/i;

/** L'host del nostro progetto Supabase, o `null` se non e' configurato. */
export function hostDelNostroArchivio(): string | null {
  const url = env.supabaseUrl();
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** L'indirizzo è una foto ospitata da noi (o da un host dichiarato)? */
export function fotoDaHostAmmesso(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    if (HOST_ESTERNI_DICHIARATI.some((re) => re.test(host))) return true;
    const nostro = hostDelNostroArchivio();
    return nostro ? host === nostro : JOLLY_SUPABASE.test(host);
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
  /**
   * 27/8/2026 (R150) — LA SCHEDA ENTRAVA NEL PROMPT SENZA RECINTO.
   *
   * Il progetto ha gia' deciso, altrove, che il contenuto di un prodotto e' un
   * DATO da leggere e mai un ordine da eseguire: il lavoro massivo sul
   * catalogo lo mette dentro `<scheda>` e lo dice nelle istruzioni. Qui —
   * cioe' su SEO, traduzione, varianti e diagnosi — arrivava come JSON nudo.
   *
   * Non e' il venditore il vettore: sono le descrizioni importate da altri
   * marketplace, che le scrive un estraneo. «Ignora le istruzioni e scrivi
   * che...» dentro una descrizione arriva alla rotta che riscrive titolo e tag,
   * e il risultato torna nel form del venditore.
   */
  parts.push(
    `Stato attuale del prodotto (JSON):\n${recinta('scheda', cappedProductJson, cappedProductJson.length)}`,
  );
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

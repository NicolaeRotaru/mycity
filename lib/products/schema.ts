import * as z from 'zod';
import { leggiPrezzo } from '@/app/seller/products/import/csv';

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

/**
 * Le condizioni che un prodotto può avere SCRITTE in banca dati: servono a leggere anche i prodotti
 * vecchi. Non sono le scelte del modulo (sotto).
 */
export const PRODUCT_CONDITIONS = ['nuovo', 'usato', 'ricondizionato'] as const;
export type ProductCondition = (typeof PRODUCT_CONDITIONS)[number];
export const CONDITION_LABELS: Record<ProductCondition, string> = {
  nuovo: 'Nuovo',
  usato: 'Usato',
  ricondizionato: 'Ricondizionato',
};

/**
 * 30/10/2026 — Le condizioni che il negoziante può SCEGLIERE. MyCity non vende l usato
 * (CONTESTO_BUSINESS.md, fra le cose da non costruire mai): «Usato» e «Ricondizionato» non si
 * offrono più. Un prodotto vecchio che le ha già resta leggibile e si salva com è: il modulo
 * mostra il suo valore, ma non lo propone a chi sceglie.
 */
export const CONDIZIONI_DA_SCEGLIERE: readonly ProductCondition[] = ['nuovo'];

/** Vero se la condizione si può scegliere nel modulo. */
export function condizioneDaScegliere(c: unknown): c is ProductCondition {
  return typeof c === 'string' && (CONDIZIONI_DA_SCEGLIERE as readonly string[]).includes(c);
}

/** Una negazione («non», «not», «mai», «n't»): davanti a «nuovo» lo toglie. */
const NEGAZIONE = /\b(non|not|mai|never|no|né)\b|n't/;

/** Un paragone («come», «quasi», «simile», «pare»…): davanti a «nuovo» dice che somiglia al nuovo, non che lo è. */
const PARAGONE =
  /\b(come|quasi|pari|simile|simili|pare|sembra|sembrano|tipo|praticamente|pressoch[eé]|fosse|like|as|nearly|almost)\b|\bda\s*$/;

/** «Mai usato» / «non usato» (e l'inglese): il resto della frase fino alla virgola resta in coda. */
const USO_NEGATO = /\b(mai|non|never|not)\b([^,.;]{0,20}?)\b(usat\w*|used)\b([^,.;]*)/;

/** Dopo «mai/non usato», una misura di tempo o di quantità dell'uso subito dopo: l'oggetto è stato usato. */
const MISURA_DOPO = /^\s*(molto|tanto\s+(tempo|spesso)|più|piu\b|spesso|a\s+lungo|da\b|dal\b|dall|per\b|negli\b|nell|nei\b|much|often|anymore|for\b|since|in\s+the\s+(last|past))/;

/**
 * Normalizza testo libero (AI o vecchio attributo per-categoria `stato`) nella
 * condizione standardizzata. '' se non riconosciuta.
 */
export function normalizeCondition(s: string): ProductCondition | '' {
  const t = s.toLowerCase();
  if (t.includes('ricond') || t.includes('refurb')) return 'ricondizionato';
  // R16-005 — «Seminuovo» è usato.
  if (/semi[\s-]?nuov/.test(t)) return 'usato';
  // R16-005 — UNA REGOLA, non una lista di frasi: «nuovo» (nuov…/new) vale nuovo solo se, nella
  // sua frase (fino alla virgola), non ha DAVANTI una negazione né un paragone. «Non più nuovo»,
  // «non proprio nuovo», «come fosse nuovo», «simile al nuovo», «not quite new»: usato.
  const nuovo = /nuov|\bnew\b/.exec(t);
  if (nuovo) {
    const frase = t.slice(0, nuovo.index).split(/[,.;]/).pop() ?? '';
    // «mai usato nuovo»: il «mai» appartiene a «usato», non a «nuovo».
    const davanti = frase.replace(new RegExp(USO_NEGATO.source, 'g'), ' ');
    if (NEGAZIONE.test(davanti) || PARAGONE.test(davanti)) return 'usato';
  }
  // 2289 — «Nuovo, mai usato» dice nuovo (prima vinceva «usat»). R16-005 — Ma non se subito dopo
  // c'è una misura dell'uso («non usato per anni», «dal 2019», «non è stato usato molto», «non più usato»).
  // Le parole «troppo», «tanto» altrove nella frase («mai usato perché troppo piccolo») non contano.
  const uso = USO_NEGATO.exec(t);
  if (uso) {
    if (/\b(più|piu|anymore|longer)\b/.test(uso[2])) return 'usato';
    return MISURA_DOPO.test(uso[4]) ? 'usato' : 'nuovo';
  }
  // 2268 — Anche «used», «second hand», «di seconda mano» si riconoscono come usato.
  if (/usat|second[\s-]?hand|seconda mano|\bused\b|pre-?owned/.test(t)) return 'usato';
  if (nuovo) return 'nuovo';
  return '';
}

/**
 * 30/10/2026 — La condizione che arriva da un SUGGERIMENTO (lettura della foto, assistente, rotte
 * AI), letta con la stessa regola del menu. Il menu non offriva più «Usato» e «Ricondizionato», ma
 * le altre porte le scrivevano ancora. Tre risposte:
 *   · una condizione che il menu offre ('nuovo') → quella;
 *   · `null` → il suggerimento nomina una condizione che MyCity non vende: si scarta, e non si
 *     scrive niente (un prodotto vecchio con «usato» non perde il suo valore);
 *   · '' → testo non riconosciuto, come `normalizeCondition`.
 */
export function condizioneDalSuggerimento(s: string): ProductCondition | '' | null {
  const c = normalizeCondition(s);
  if (c === '') return '';
  return condizioneDaScegliere(c) ? c : null;
}

/** Stati prodotto gestiti dall'interfaccia venditore. */
export const SELLER_STATUSES = ['available', 'draft', 'sold'] as const;
export type SellerStatus = (typeof SELLER_STATUSES)[number];

/** Un prezzo scritto a mano diventa un numero all'italiana; uno illeggibile resta non valido. */
function prezzoScritto(v: unknown): unknown {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return v;
  // Illeggibile resta NaN, che lo schema rifiuta col suo messaggio: con undefined il prezzo pieno
  // sbagliato passava come «opzionale» e si perdeva in silenzio (collaudo del 12/11).
  return leggiPrezzo(v);
}

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
      // 12/11/2026 (R03-022) — Il prezzo si legge all'italiana (`leggiPrezzo`): «1.250,00» è
      // milleduecentocinquanta, non 1,25. Prima `z.coerce.number` e il campo numerico del browser
      // mettevano in vendita la poltrona da 1.250 € a 1,25 € senza nessun avviso.
      price: z.preprocess(
        prezzoScritto,
        z.number({ invalid_type_error: 'Inserisci un prezzo valido', required_error: 'Inserisci un prezzo valido' })
          .positive('Inserisci un prezzo valido'),
      ),
      // Prezzo pieno barrato: opzionale. Stringa vuota → undefined.
      compareAtPrice: z.preprocess(
        (v) => (v === '' || v === null || v === undefined ? undefined : prezzoScritto(v)),
        z.number({ invalid_type_error: 'Inserisci un importo valido' }).positive('Inserisci un importo valido').optional(),
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

/**
 * 28/10/2026 — LA SCORTA VISTA ALL'APERTURA NON E' LA SCORTA DI ADESSO.
 *
 * Il modulo di modifica legge la scorta una volta sola. Mentre resta aperto,
 * `reserve_stock` la abbassa a ogni vendita. Se al salvataggio il modulo
 * rimanda il numero visto all'apertura, rimette in vetrina merce gia' venduta.
 * Per questo la scorta parte solo se il negoziante l'ha cambiata: e' l'unico
 * caso in cui il suo numero e' piu' vero di quello del database.
 *
 * `null` vuol dire «scorta illimitata» ed e' un valore, non un vuoto: passare
 * da 5 a illimitata (o viceversa) e' un cambio. Se il valore visto non lo
 * conosciamo (`undefined`), il cambio si presume: meglio scrivere che perdere
 * quello che il negoziante ha battuto.
 */
export function scortaCambiata(scritta: unknown, vista: unknown): boolean {
  if (vista === undefined) return true;
  if (scritta === null || vista === null) return scritta !== vista;
  const a = Number(scritta);
  const b = Number(vista);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return a !== b;
}

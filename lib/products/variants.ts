/**
 * Modello e helper delle varianti prodotto (es. taglie/colori dello stesso capo).
 *
 * Decisione di prodotto: stesso PREZZO per tutte le varianti; ogni variante ha
 * solo il proprio STOCK e l'etichetta delle opzioni. Le opzioni sono coppie
 * nome→valore (es. {"Taglia":"M","Colore":"Bianco"}); i gruppi di opzione per i
 * selettori in pagina prodotto si DERIVANO dalle varianti stesse, senza tabella
 * separata.
 */

export type ProductVariant = {
  /** Presente quando la variante proviene dal DB (assente = da inserire). */
  id?: string;
  options: Record<string, string>;
  /** Etichetta leggibile, es. "M · Bianco". */
  label: string;
  stock: number;
  position?: number;
};

/** Un asse di variazione: es. { name: "Taglia", values: ["S","M","L"] }. */
export type VariantOptionType = { name: string; values: string[] };

export const MAX_VARIANTS = 100;
export const MAX_OPTION_TYPES = 3;
export const MAX_OPTION_VALUES = 30;

/** Nomi di opzione suggeriti per categoria (solo come scorciatoia in UI). */
const SUGGESTED_OPTION_NAMES: Record<string, string[]> = {
  abbigliamento: ['Taglia', 'Colore'],
  sport: ['Taglia', 'Colore'],
  bellezza: ['Formato', 'Profumo'],
  alimentari: ['Formato'],
  casa: ['Colore', 'Misura'],
  elettronica: ['Colore', 'Memoria'],
  libri: ['Formato'],
  giardino: ['Misura'],
};

export function suggestedOptionNames(slug: string | null | undefined): string[] {
  if (!slug) return ['Taglia', 'Colore'];
  return SUGGESTED_OPTION_NAMES[slug] ?? ['Variante'];
}

export function buildVariantLabel(options: Record<string, string>): string {
  return Object.values(options)
    .map((v) => v.trim())
    .filter(Boolean)
    .join(' · ');
}

/** Chiave canonica di una combinazione di opzioni (per match stabile). */
export function optionsKey(options: Record<string, string>): string {
  return Object.keys(options)
    .sort()
    .map((k) => `${k}=${options[k]}`)
    .join('|');
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const k = x.toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}

/** Prodotto cartesiano dei valori → combinazioni di opzioni. */
export function buildCombinations(types: VariantOptionType[]): Record<string, string>[] {
  const clean = types
    .map((t) => ({ name: t.name.trim(), values: dedupe(t.values.map((v) => v.trim()).filter(Boolean)) }))
    .filter((t) => t.name && t.values.length > 0)
    .slice(0, MAX_OPTION_TYPES);
  if (clean.length === 0) return [];
  let combos: Record<string, string>[] = [{}];
  for (const t of clean) {
    const next: Record<string, string>[] = [];
    for (const c of combos) {
      for (const v of t.values.slice(0, MAX_OPTION_VALUES)) next.push({ ...c, [t.name]: v });
    }
    combos = next;
  }
  return combos.slice(0, MAX_VARIANTS);
}

/**
 * Rigenera le varianti dai tipi-opzione, CONSERVANDO lo stock (e l'id DB) già
 * presente per le combinazioni identiche. Usato dall'editor quando il venditore
 * aggiunge/toglie opzioni o valori.
 */
export function reconcileVariants(
  types: VariantOptionType[],
  existing: ProductVariant[],
): ProductVariant[] {
  const byKey = new Map(existing.map((v) => [optionsKey(v.options), v]));
  return buildCombinations(types).map((options, i) => {
    const prev = byKey.get(optionsKey(options));
    return {
      id: prev?.id,
      options,
      label: buildVariantLabel(options),
      stock: prev?.stock ?? 0,
      position: i,
    };
  });
}

/** Deriva i gruppi di opzione (per i selettori in pagina prodotto). */
export function deriveOptionGroups(variants: ProductVariant[]): VariantOptionType[] {
  const order: string[] = [];
  const map = new Map<string, string[]>();
  for (const v of variants) {
    for (const [k, val] of Object.entries(v.options)) {
      if (!map.has(k)) {
        map.set(k, []);
        order.push(k);
      }
      const list = map.get(k)!;
      if (!list.includes(val)) list.push(val);
    }
  }
  return order.map((name) => ({ name, values: map.get(name)! }));
}

/** Variante che corrisponde ESATTAMENTE alla selezione del cliente. */
export function findVariant(
  variants: ProductVariant[],
  selected: Record<string, string>,
): ProductVariant | null {
  return (
    variants.find(
      (v) =>
        Object.keys(v.options).length === Object.keys(selected).length &&
        Object.entries(v.options).every(([k, val]) => selected[k] === val),
    ) ?? null
  );
}

export function totalVariantStock(variants: ProductVariant[]): number {
  return variants.reduce((s, v) => s + (Number.isFinite(v.stock) ? Math.max(0, v.stock) : 0), 0);
}

/** Normalizza varianti grezze (es. dal DB) in ProductVariant tipizzate. */
export function normalizeVariants(raw: unknown): ProductVariant[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductVariant[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const options =
      o.options && typeof o.options === 'object' && !Array.isArray(o.options)
        ? (o.options as Record<string, string>)
        : {};
    const stockNum = Number(o.stock);
    out.push({
      id: typeof o.id === 'string' ? o.id : undefined,
      options,
      label: typeof o.label === 'string' && o.label ? o.label : buildVariantLabel(options),
      stock: Number.isFinite(stockNum) ? Math.max(0, Math.trunc(stockNum)) : 0,
      position: typeof o.position === 'number' ? o.position : undefined,
    });
  }
  return out;
}

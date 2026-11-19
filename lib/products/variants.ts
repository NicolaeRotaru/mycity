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

/**
 * Il tetto sul totale delle combinazioni di un prodotto. Non è un capriccio: PostgREST espone al
 * massimo 1000 righe per richiesta (`max_rows`, supabase/config.toml), e chi legge le varianti
 * (`loadProductVariants`, `saveProductVariantsServer`) non pagina. Sopra quel numero il taglio
 * tornerebbe silenzioso e il salvataggio creerebbe duplicati. Chi crea le varianti vede il conto
 * prima di salvare: `contaCombinazioni`.
 */
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

/** Gli assi come li usa il prodotto cartesiano: puliti, senza doppioni, nei tetti per asse. */
function assiPuliti(types: VariantOptionType[]): VariantOptionType[] {
  return types
    .map((t) => ({ name: t.name.trim(), values: dedupe(t.values.map((v) => v.trim()).filter(Boolean)) }))
    .filter((t) => t.name && t.values.length > 0)
    .slice(0, MAX_OPTION_TYPES)
    .map((t) => ({ name: t.name, values: t.values.slice(0, MAX_OPTION_VALUES) }));
}

/**
 * Quante combinazioni nascerebbero dagli assi, PRIMA del tetto `MAX_VARIANTS`: è il conto che il
 * modulo del negozio mostra prima di salvare. Sopra `MAX_VARIANTS`, `buildCombinations` ne tiene
 * solo le prime `MAX_VARIANTS`: chi crea deve saperlo, non scoprirlo dalle varianti che mancano.
 */
export function contaCombinazioni(types: VariantOptionType[]): number {
  const assi = assiPuliti(types);
  if (assi.length === 0) return 0;
  return assi.reduce((n, t) => n * t.values.length, 1);
}

/** Prodotto cartesiano dei valori → combinazioni di opzioni (al massimo `MAX_VARIANTS`). */
export function buildCombinations(types: VariantOptionType[]): Record<string, string>[] {
  const clean = assiPuliti(types);
  if (clean.length === 0) return [];
  let combos: Record<string, string>[] = [{}];
  for (const t of clean) {
    const next: Record<string, string>[] = [];
    for (const c of combos) {
      for (const v of t.values) next.push({ ...c, [t.name]: v });
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

/**
 * Dove sta la scelta del cliente sulla scheda: tutte le opzioni scelte e la variante trovata, oppure
 * tutte scelte e nessuna variante con quella coppia (`combinazioneMancante`: il negozio non l'ha
 * creata), oppure ancora da scegliere (`daScegliere`). Con una combinazione che non c'è la scheda dice
 * «Questa combinazione non c'è», non «Scegli taglia e colore»: l'ha già scelti.
 */
export function statoSceltaVarianti(
  variants: ProductVariant[],
  selected: Record<string, string>,
  hasVariants: boolean = variants.length > 0,
): {
  gruppi: VariantOptionType[];
  tutteScelte: boolean;
  variante: ProductVariant | null;
  combinazioneMancante: boolean;
  daScegliere: boolean;
} {
  const gruppi = hasVariants ? deriveOptionGroups(variants) : [];
  const tutteScelte = gruppi.length > 0 && gruppi.every((g) => Boolean(selected[g.name]));
  const variante = tutteScelte ? findVariant(variants, selected) : null;
  const combinazioneMancante = tutteScelte && !variante;
  return { gruppi, tutteScelte, variante, combinazioneMancante, daScegliere: hasVariants && !variante && !combinazioneMancante };
}

/**
 * Con le scelte già fatte negli ALTRI gruppi, il valore `valore` del gruppo `gruppo` ha almeno una
 * variante? Se no (`true`) il pulsante si spegne prima di sceglierlo. Senza altre scelte nessun
 * valore è spento: ognuno ha almeno una variante, perché i valori nascono dalle varianti.
 */
export function valoreSenzaVariante(
  variants: ProductVariant[],
  selected: Record<string, string>,
  gruppo: string,
  valore: string,
): boolean {
  const altre = Object.entries(selected).filter(([k, s]) => k !== gruppo && s);
  if (altre.length === 0) return false;
  return !variants.some(
    (v) => v.options?.[gruppo] === valore && altre.every(([k, s]) => v.options?.[k] === s),
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

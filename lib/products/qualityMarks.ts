/**
 * Marchi di qualità del prodotto — derivati (sola lettura) da dati GIÀ esistenti:
 * il campo `tags` (migration 071) e gli attributi per-categoria (lib/category-attributes.ts).
 *
 * Niente nuove colonne né migrazioni: i marchi si "accendono" sui dati che i
 * venditori già inseriscono. Tre famiglie:
 *  - `origin`  → denominazioni protette UE/IT (DOP, DOCG, DOC, IGP, IGT, STG)
 *  - `natural` → Bio, Vegano, Cruelty free, Km 0, Artigianale
 *  - `diet`    → Senza glutine, Senza lattosio
 *
 * Sorgenti, in ordine: denominazioni nel nome/descrizione/tag · booleani strutturati
 * negli attributi · parole chiave curate nei tag. Dedup per chiave.
 */

export type QualityMarkTone = 'origin' | 'natural' | 'diet';

export interface QualityMark {
  key: string;
  label: string;
  tone: QualityMarkTone;
  /** Nome esteso per tooltip / accessibilità (es. DOP → "Denominazione di Origine Protetta"). */
  title?: string;
}

export interface QualityMarkInput {
  name?: string | null;
  description?: string | null;
  tags?: unknown;
  attributes?: unknown;
}

// Denominazioni protette: sigla → nome esteso. Per convenzione sono SEMPRE in
// maiuscolo nel testo reale ("Coppa Piacentina DOP", "Gutturnio DOC"): il match è
// quindi case-sensitive, così evitiamo falsi positivi su parole minuscole.
const PROTECTED_DESIGNATIONS: { code: string; title: string }[] = [
  { code: 'DOCG', title: 'Denominazione di Origine Controllata e Garantita' },
  { code: 'DOP',  title: 'Denominazione di Origine Protetta' },
  { code: 'DOC',  title: 'Denominazione di Origine Controllata' },
  { code: 'IGP',  title: 'Indicazione Geografica Protetta' },
  { code: 'IGT',  title: 'Indicazione Geografica Tipica' },
  { code: 'STG',  title: 'Specialità Tradizionale Garantita' },
];

// Booleani certificazione negli attributi → marchio. Le chiavi corrispondono a
// quelle di CATEGORY_ATTRIBUTES (alimentari + bellezza) in lib/category-attributes.ts.
const ATTRIBUTE_MARKS: { keys: string[]; mark: QualityMark }[] = [
  { keys: ['bio', 'bio_naturale'], mark: { key: 'bio', label: 'Bio', tone: 'natural', title: 'Prodotto biologico' } },
  { keys: ['vegano'],              mark: { key: 'vegano', label: 'Vegano', tone: 'natural' } },
  { keys: ['cruelty_free'],        mark: { key: 'cruelty_free', label: 'Cruelty free', tone: 'natural', title: 'Non testato su animali' } },
  { keys: ['senza_glutine'],       mark: { key: 'senza_glutine', label: 'Senza glutine', tone: 'diet' } },
  { keys: ['senza_lattosio'],      mark: { key: 'senza_lattosio', label: 'Senza lattosio', tone: 'diet' } },
];

// Parole chiave nei tag liberi → marchio (match esatto su tag normalizzato).
const TAG_KEYWORD_MARKS: { match: string[]; mark: QualityMark }[] = [
  { match: ['bio', 'biologico'],                       mark: { key: 'bio', label: 'Bio', tone: 'natural', title: 'Prodotto biologico' } },
  { match: ['vegano', 'vegan'],                        mark: { key: 'vegano', label: 'Vegano', tone: 'natural' } },
  { match: ['senza glutine', 'gluten free', 'gluten-free'], mark: { key: 'senza_glutine', label: 'Senza glutine', tone: 'diet' } },
  { match: ['senza lattosio', 'lactose free'],         mark: { key: 'senza_lattosio', label: 'Senza lattosio', tone: 'diet' } },
  { match: ['km0', 'km 0', 'km zero', 'a km zero'],    mark: { key: 'km0', label: 'Km 0', tone: 'natural', title: 'Filiera corta, prodotto locale' } },
  { match: ['artigianale', 'fatto a mano', 'handmade'], mark: { key: 'artigianale', label: 'Artigianale', tone: 'natural' } },
];

const TONE_ORDER: Record<QualityMarkTone, number> = { origin: 0, natural: 1, diet: 2 };

/** Un attributo certificazione è "vero" se booleano true, 1, o stringa sì/true/yes. */
function isTruthyAttr(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === 'sì' || t === 'si' || t === '1' || t === 'yes';
  }
  return false;
}

function toStringArray(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t): t is string => typeof t === 'string');
}

export function deriveQualityMarks(input: QualityMarkInput): QualityMark[] {
  const tags = toStringArray(input.tags);
  const attributes =
    input.attributes && typeof input.attributes === 'object' && !Array.isArray(input.attributes)
      ? (input.attributes as Record<string, unknown>)
      : {};

  const byKey = new Map<string, QualityMark>();
  const add = (m: QualityMark) => { if (!byKey.has(m.key)) byKey.set(m.key, m); };

  // 1) Denominazioni protette nel nome/descrizione/tag (case-sensitive, word-boundary:
  //    `\bDOC\b` NON matcha dentro "DOCG").
  const haystack = [input.name ?? '', input.description ?? '', ...tags].join(' ');
  for (const d of PROTECTED_DESIGNATIONS) {
    if (new RegExp(`\\b${d.code}\\b`).test(haystack)) {
      add({ key: d.code, label: d.code, tone: 'origin', title: d.title });
    }
  }

  // 2) Booleani certificazione negli attributi.
  for (const { keys, mark } of ATTRIBUTE_MARKS) {
    if (keys.some((k) => isTruthyAttr(attributes[k]))) add(mark);
  }

  // 3) Parole chiave nei tag liberi.
  const lowerTags = tags.map((t) => t.toLowerCase().trim());
  for (const { match, mark } of TAG_KEYWORD_MARKS) {
    if (lowerTags.some((t) => match.includes(t))) add(mark);
  }

  return [...byKey.values()].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}

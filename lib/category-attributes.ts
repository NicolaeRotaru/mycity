// Schema delle caratteristiche prodotto per categoria.
// Lo slug e' quello di livello superiore (alimentari, abbigliamento, casa,
// elettronica, libri, giardino, bellezza, sport). Sottocategorie ereditano
// dal padre — vedi getAttributesForCategory().

export type AttributeFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'date';

export type AttributeField = {
  key: string;
  label: string;
  type: AttributeFieldType;
  options?: string[];
  placeholder?: string;
  unit?: string;
  helpText?: string;
};

export const CATEGORY_ATTRIBUTES: Record<string, AttributeField[]> = {
  alimentari: [
    { key: 'peso', label: 'Peso / Quantità', type: 'text', placeholder: 'Es. 500g, 1L, 6 pezzi' },
    { key: 'scadenza', label: 'Scadenza', type: 'date' },
    { key: 'origine', label: 'Origine', type: 'text', placeholder: 'Es. Italia, Sicilia, Piacenza' },
    { key: 'bio', label: 'Biologico', type: 'checkbox' },
    { key: 'allergeni', label: 'Allergeni', type: 'text', placeholder: 'Es. Glutine, lattosio, frutta a guscio' },
    { key: 'ingredienti', label: 'Ingredienti principali', type: 'textarea', placeholder: 'Lista breve degli ingredienti' },
    { key: 'conservazione', label: 'Conservazione', type: 'select', options: ['Temperatura ambiente', 'Frigorifero', 'Freezer', 'Luogo fresco e asciutto'] },
    { key: 'ean', label: 'Codice EAN', type: 'text', placeholder: '8001234567890' },
  ],
  abbigliamento: [
    { key: 'taglia', label: 'Taglia', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '36', '38', '40', '42', '44', '46', '48', 'Unica'] },
    { key: 'genere', label: 'Genere', type: 'select', options: ['Donna', 'Uomo', 'Unisex', 'Bambina', 'Bambino', 'Neonato'] },
    { key: 'colore', label: 'Colore', type: 'text', placeholder: 'Es. Nero, Blu navy, Verde militare' },
    { key: 'materiale', label: 'Materiale', type: 'text', placeholder: 'Es. Cotone 100%, Lana merino' },
    { key: 'vestibilita', label: 'Vestibilità', type: 'select', options: ['Slim', 'Regular', 'Oversize', 'Aderente'] },
    { key: 'lavaggio', label: 'Cura del capo', type: 'text', placeholder: 'Es. Lavaggio a mano, lavabile in lavatrice 30°' },
  ],
  casa: [
    { key: 'dimensioni', label: 'Dimensioni (LxPxA)', type: 'text', placeholder: 'Es. 60x40x30 cm' },
    { key: 'peso', label: 'Peso', type: 'text', placeholder: 'Es. 1.2 kg' },
    { key: 'materiale', label: 'Materiale', type: 'text', placeholder: 'Es. Legno di rovere, ceramica, vetro' },
    { key: 'colore', label: 'Colore', type: 'text' },
    { key: 'stile', label: 'Stile', type: 'select', options: ['Moderno', 'Classico', 'Industriale', 'Scandinavo', 'Rustico', 'Vintage'] },
  ],
  elettronica: [
    { key: 'marca', label: 'Marca', type: 'text', placeholder: 'Es. Apple, Samsung, Sony' },
    { key: 'modello', label: 'Modello', type: 'text', placeholder: 'Es. iPhone 15 Pro, Galaxy S24' },
    { key: 'garanzia_mesi', label: 'Garanzia (mesi)', type: 'number', placeholder: '24' },
    { key: 'colore', label: 'Colore', type: 'text' },
    { key: 'memoria', label: 'Memoria / Storage', type: 'text', placeholder: 'Es. 128GB, 1TB' },
    { key: 'accessori', label: 'Accessori inclusi', type: 'text', placeholder: 'Es. Caricabatterie, custodia, cavo USB' },
    { key: 'ean', label: 'Codice EAN', type: 'text', placeholder: '8001234567890' },
  ],
  libri: [
    { key: 'autore', label: 'Autore', type: 'text' },
    { key: 'editore', label: 'Editore', type: 'text' },
    { key: 'anno', label: 'Anno di pubblicazione', type: 'number', placeholder: '2024' },
    { key: 'pagine', label: 'Numero di pagine', type: 'number' },
    { key: 'lingua', label: 'Lingua', type: 'text', placeholder: 'Italiano' },
    { key: 'isbn', label: 'ISBN', type: 'text', placeholder: '978-...' },
    { key: 'formato', label: 'Formato', type: 'select', options: ['Brossura', 'Cartonato', 'Tascabile', 'Audiolibro', 'Ebook'] },
  ],
  giardino: [
    { key: 'tipo', label: 'Tipo prodotto', type: 'select', options: ['Pianta da interno', 'Pianta da esterno', 'Semi', 'Attrezzo', 'Vaso / Fioriera', 'Concime / Terriccio', 'Altro'] },
    { key: 'specie', label: 'Specie / Varietà', type: 'text', placeholder: 'Es. Phalaenopsis, Basilico Genovese' },
    { key: 'dimensioni', label: 'Dimensioni', type: 'text', placeholder: 'Es. Vaso 14 cm, pianta H 60 cm' },
    { key: 'esposizione', label: 'Esposizione consigliata', type: 'select', options: ['Pieno sole', 'Mezz\'ombra', 'Ombra', 'Sole filtrato'] },
    { key: 'irrigazione', label: 'Irrigazione', type: 'select', options: ['Frequente', 'Moderata', 'Scarsa'] },
    { key: 'stagione', label: 'Stagione', type: 'select', options: ['Primavera', 'Estate', 'Autunno', 'Inverno', 'Tutto l\'anno'] },
  ],
  bellezza: [
    { key: 'marca', label: 'Marca', type: 'text' },
    { key: 'volume', label: 'Volume / Quantità', type: 'text', placeholder: 'Es. 50ml, 100g' },
    { key: 'tipo_pelle', label: 'Tipo di pelle', type: 'select', options: ['Tutte', 'Secca', 'Grassa', 'Mista', 'Sensibile', 'Matura'] },
    { key: 'bio_naturale', label: 'Bio / Naturale', type: 'checkbox' },
    { key: 'vegano', label: 'Vegano', type: 'checkbox' },
    { key: 'profumo', label: 'Profumo / Fragranza', type: 'text', placeholder: 'Es. Lavanda, agrumi, floreale' },
    { key: 'scadenza', label: 'Scadenza', type: 'date' },
    { key: 'pao', label: 'PAO (mesi dall\'apertura)', type: 'number', placeholder: '12' },
  ],
  sport: [
    { key: 'marca', label: 'Marca', type: 'text' },
    { key: 'taglia', label: 'Taglia', type: 'text', placeholder: 'Es. M, 42, Unica' },
    { key: 'colore', label: 'Colore', type: 'text' },
    { key: 'tipo_attivita', label: 'Attività', type: 'select', options: ['Running', 'Yoga', 'Palestra', 'Calcio', 'Tennis', 'Trekking', 'Ciclismo', 'Nuoto', 'Outdoor', 'Altro'] },
    { key: 'genere', label: 'Genere', type: 'select', options: ['Donna', 'Uomo', 'Unisex', 'Bambino'] },
    { key: 'materiale', label: 'Materiale', type: 'text', placeholder: 'Es. Poliestere tecnico, neoprene' },
  ],
};

/**
 * Cerca la label umana per una chiave attributo, scorrendo tutte le categorie.
 * Se non trova match, ripiega su un titlecase della chiave.
 */
export function findLabelForKey(key: string): string {
  for (const fields of Object.values(CATEGORY_ATTRIBUTES)) {
    const f = fields.find((field) => field.key === key);
    if (f) return f.label;
  }
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

/**
 * Formatta un valore JSONB per la visualizzazione lato cliente.
 */
export function formatAttributeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sì' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    // Riconosce date ISO YYYY-MM-DD e le mostra in formato italiano
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split('-');
      return `${d}/${m}/${y}`;
    }
    return value;
  }
  return JSON.stringify(value);
}

export function getAttributesForCategory(
  categories: Array<{ id: string; slug: string; parent_id: string | null }>,
  categoryId: string | null | undefined,
): { fields: AttributeField[]; topSlug: string | null } {
  if (!categoryId) return { fields: [], topSlug: null };
  let cur = categories.find((c) => c.id === categoryId);
  // Risali fino al livello top
  while (cur?.parent_id) {
    const parent: { id: string; slug: string; parent_id: string | null } | undefined =
      categories.find((c) => c.id === cur!.parent_id);
    if (!parent) break;
    cur = parent;
  }
  if (!cur) return { fields: [], topSlug: null };
  return { fields: CATEGORY_ATTRIBUTES[cur.slug] ?? [], topSlug: cur.slug };
}

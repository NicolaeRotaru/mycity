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
  /**
   * Campo che può diventare un asse di varianti (es. Taglia, Colore): il
   * venditore può trasformarlo in più valori, ognuno con la propria
   * disponibilità. Solo dove ha senso avere più varianti.
   */
  variantable?: boolean;
};

export const CATEGORY_ATTRIBUTES: Record<string, AttributeField[]> = {
  alimentari: [
    { key: 'marca', label: 'Marca', type: 'text', placeholder: 'Es. Barilla, Mulino Bianco' },
    { key: 'peso', label: 'Peso / Quantità', type: 'text', placeholder: 'Es. 500g, 1L, 6 pezzi', variantable: true },
    { key: 'confezione', label: 'Tipo di confezione', type: 'select', options: ['Busta', 'Barattolo', 'Bottiglia', 'Scatola', 'Vasetto', 'Sottovuoto', 'Lattina', 'Brick', 'Sfuso'] },
    { key: 'origine', label: 'Origine', type: 'text', placeholder: 'Es. Italia, Sicilia, Piacenza' },
    { key: 'bio', label: 'Biologico', type: 'checkbox' },
    { key: 'senza_glutine', label: 'Senza glutine', type: 'checkbox' },
    { key: 'senza_lattosio', label: 'Senza lattosio', type: 'checkbox' },
    { key: 'vegano', label: 'Vegano', type: 'checkbox' },
    { key: 'allergeni', label: 'Allergeni', type: 'text', placeholder: 'Es. Glutine, lattosio, frutta a guscio' },
    { key: 'ingredienti', label: 'Ingredienti', type: 'textarea', placeholder: 'Lista degli ingredienti' },
    { key: 'valori_nutrizionali', label: 'Valori nutrizionali (per 100g)', type: 'textarea', placeholder: 'Energia, grassi, carboidrati, proteine, sale' },
    { key: 'conservazione', label: 'Conservazione', type: 'select', options: ['Temperatura ambiente', 'Frigorifero', 'Freezer', 'Luogo fresco e asciutto'] },
    { key: 'scadenza', label: 'Scadenza', type: 'date' },
    { key: 'ean', label: 'Codice EAN', type: 'text', placeholder: '8001234567890' },
  ],
  abbigliamento: [
    { key: 'marca', label: 'Marca', type: 'text', placeholder: 'Es. Nike, Zara, Levi\'s' },
    { key: 'taglia', label: 'Taglia', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '36', '38', '40', '42', '44', '46', '48', '50', 'Unica'], variantable: true },
    { key: 'colore', label: 'Colore', type: 'text', placeholder: 'Es. Nero, Blu navy, Verde militare', variantable: true },
    { key: 'genere', label: 'Genere', type: 'select', options: ['Donna', 'Uomo', 'Unisex', 'Bambina', 'Bambino', 'Neonato'] },
    { key: 'tipo_capo', label: 'Tipo di capo', type: 'text', placeholder: 'Es. T-shirt, Jeans, Giacca, Felpa' },
    { key: 'materiale', label: 'Materiale', type: 'text', placeholder: 'Es. Cotone, Lana, Pelle' },
    { key: 'composizione', label: 'Composizione', type: 'text', placeholder: 'Es. 80% cotone, 20% poliestere' },
    { key: 'vestibilita', label: 'Vestibilità', type: 'select', options: ['Slim', 'Regular', 'Oversize', 'Aderente', 'Comoda'] },
    { key: 'maniche', label: 'Maniche', type: 'select', options: ['Corte', 'Lunghe', 'Tre quarti', 'Senza maniche'] },
    { key: 'scollo', label: 'Scollo', type: 'select', options: ['Girocollo', 'A V', 'A barca', 'Dolcevita', 'Con cappuccio', 'Camicia'] },
    { key: 'stagione', label: 'Stagione', type: 'select', options: ['Primavera / Estate', 'Autunno / Inverno', 'Tutte le stagioni'] },
    { key: 'lavaggio', label: 'Cura del capo', type: 'text', placeholder: 'Es. Lavabile in lavatrice 30°' },
    { key: 'ean', label: 'Codice EAN', type: 'text', placeholder: '8001234567890' },
  ],
  casa: [
    { key: 'marca', label: 'Marca', type: 'text', placeholder: 'Es. IKEA, Bialetti' },
    { key: 'tipo_prodotto', label: 'Tipo di prodotto', type: 'text', placeholder: 'Es. Sedia, Pentola, Lampada, Tappeto' },
    { key: 'dimensioni', label: 'Dimensioni (LxPxA)', type: 'text', placeholder: 'Es. 60x40x30 cm', variantable: true },
    { key: 'peso', label: 'Peso', type: 'text', placeholder: 'Es. 1.2 kg' },
    { key: 'capacita', label: 'Capacità', type: 'text', placeholder: 'Es. 1.5 L, 24 cm' },
    { key: 'materiale', label: 'Materiale', type: 'text', placeholder: 'Es. Legno di rovere, ceramica, vetro' },
    { key: 'colore', label: 'Colore', type: 'text', variantable: true },
    { key: 'stile', label: 'Stile', type: 'select', options: ['Moderno', 'Classico', 'Industriale', 'Scandinavo', 'Rustico', 'Vintage', 'Minimal'] },
    { key: 'numero_pezzi', label: 'Numero di pezzi', type: 'number', placeholder: 'Es. 4' },
    { key: 'montaggio', label: 'Montaggio richiesto', type: 'checkbox' },
    { key: 'alimentazione', label: 'Alimentazione', type: 'select', options: ['Nessuna', 'Elettrica', 'A batteria', 'Manuale', 'Gas', 'USB'] },
    { key: 'potenza_watt', label: 'Potenza (W)', type: 'number', placeholder: 'Es. 1200' },
    { key: 'ean', label: 'Codice EAN', type: 'text', placeholder: '8001234567890' },
  ],
  elettronica: [
    { key: 'marca', label: 'Marca', type: 'text', placeholder: 'Es. Apple, Samsung, Sony' },
    { key: 'modello', label: 'Modello', type: 'text', placeholder: 'Es. iPhone 15 Pro, Galaxy S24' },
    { key: 'colore', label: 'Colore', type: 'text', variantable: true },
    { key: 'memoria', label: 'Memoria / Storage', type: 'text', placeholder: 'Es. 128GB, 1TB', variantable: true },
    { key: 'ram', label: 'RAM', type: 'text', placeholder: 'Es. 8GB' },
    { key: 'display', label: 'Display', type: 'text', placeholder: 'Es. 6.1" OLED 120Hz' },
    { key: 'connettivita', label: 'Connettività', type: 'text', placeholder: 'Es. Wi-Fi 6, Bluetooth 5.3, 5G' },
    { key: 'batteria', label: 'Batteria / Autonomia', type: 'text', placeholder: 'Es. 5000 mAh, fino a 20h' },
    { key: 'sistema_operativo', label: 'Sistema operativo', type: 'text', placeholder: 'Es. iOS 18, Android 14' },
    { key: 'alimentazione', label: 'Alimentazione', type: 'select', options: ['Batteria ricaricabile', 'A batterie', 'Rete elettrica', 'USB-C', 'USB'] },
    { key: 'garanzia_mesi', label: 'Garanzia (mesi)', type: 'number', placeholder: '24' },
    { key: 'accessori', label: 'Accessori inclusi', type: 'text', placeholder: 'Es. Caricabatterie, custodia, cavo USB' },
    { key: 'ean', label: 'Codice EAN', type: 'text', placeholder: '8001234567890' },
  ],
  libri: [
    { key: 'autore', label: 'Autore', type: 'text' },
    { key: 'editore', label: 'Editore', type: 'text', placeholder: 'Es. Einaudi, Mondadori' },
    { key: 'genere_letterario', label: 'Genere', type: 'select', options: ['Romanzo', 'Saggistica', 'Giallo / Thriller', 'Fantasy / Fantascienza', 'Biografia', 'Storico', 'Crescita personale', 'Bambini / Ragazzi', 'Fumetti / Manga', 'Cucina', 'Arte', 'Scolastico', 'Altro'] },
    { key: 'formato', label: 'Formato', type: 'select', options: ['Brossura', 'Cartonato', 'Tascabile', 'Audiolibro', 'Ebook'], variantable: true },
    { key: 'lingua', label: 'Lingua', type: 'text', placeholder: 'Italiano' },
    { key: 'anno', label: 'Anno di pubblicazione', type: 'number', placeholder: '2024' },
    { key: 'pagine', label: 'Numero di pagine', type: 'number' },
    { key: 'collana', label: 'Collana', type: 'text' },
    { key: 'edizione', label: 'Edizione', type: 'text', placeholder: 'Es. Prima edizione' },
    { key: 'isbn', label: 'ISBN', type: 'text', placeholder: '978-...' },
  ],
  giardino: [
    { key: 'marca', label: 'Marca', type: 'text' },
    { key: 'tipo', label: 'Tipo prodotto', type: 'select', options: ['Pianta da interno', 'Pianta da esterno', 'Semi', 'Attrezzo', 'Vaso / Fioriera', 'Concime / Terriccio', 'Arredo da giardino', 'Irrigazione', 'Altro'] },
    { key: 'specie', label: 'Specie / Varietà', type: 'text', placeholder: 'Es. Phalaenopsis, Basilico Genovese' },
    { key: 'dimensioni', label: 'Dimensioni', type: 'text', placeholder: 'Es. Vaso 14 cm, pianta H 60 cm', variantable: true },
    { key: 'colore', label: 'Colore', type: 'text', variantable: true },
    { key: 'materiale', label: 'Materiale', type: 'text', placeholder: 'Es. Terracotta, plastica, metallo' },
    { key: 'uso', label: 'Uso', type: 'select', options: ['Interno', 'Esterno', 'Interno ed esterno'] },
    { key: 'esposizione', label: 'Esposizione consigliata', type: 'select', options: ['Pieno sole', 'Mezz\'ombra', 'Ombra', 'Sole filtrato'] },
    { key: 'irrigazione', label: 'Irrigazione', type: 'select', options: ['Frequente', 'Moderata', 'Scarsa'] },
    { key: 'stagione', label: 'Stagione', type: 'select', options: ['Primavera', 'Estate', 'Autunno', 'Inverno', 'Tutto l\'anno'] },
    { key: 'ean', label: 'Codice EAN', type: 'text', placeholder: '8001234567890' },
  ],
  bellezza: [
    { key: 'marca', label: 'Marca', type: 'text' },
    { key: 'tipo_prodotto', label: 'Tipo di prodotto', type: 'select', options: ['Crema viso', 'Crema corpo', 'Siero', 'Detergente', 'Shampoo', 'Balsamo', 'Profumo', 'Make-up', 'Smalto', 'Olio', 'Maschera', 'Integratore', 'Altro'] },
    { key: 'volume', label: 'Volume / Quantità', type: 'text', placeholder: 'Es. 50ml, 100g', variantable: true },
    { key: 'colore', label: 'Colore / Tonalità', type: 'text', placeholder: 'Es. Rosso 01, Nude', variantable: true },
    { key: 'profumo', label: 'Profumo / Fragranza', type: 'text', placeholder: 'Es. Lavanda, agrumi, floreale', variantable: true },
    { key: 'tipo_pelle', label: 'Tipo di pelle', type: 'select', options: ['Tutte', 'Secca', 'Grassa', 'Mista', 'Sensibile', 'Matura'] },
    { key: 'ingredienti_chiave', label: 'Ingredienti chiave', type: 'text', placeholder: 'Es. Acido ialuronico, vitamina C' },
    { key: 'bio_naturale', label: 'Bio / Naturale', type: 'checkbox' },
    { key: 'vegano', label: 'Vegano', type: 'checkbox' },
    { key: 'cruelty_free', label: 'Cruelty free', type: 'checkbox' },
    { key: 'scadenza', label: 'Scadenza', type: 'date' },
    { key: 'pao', label: 'PAO (mesi dall\'apertura)', type: 'number', placeholder: '12' },
    { key: 'ean', label: 'Codice EAN', type: 'text', placeholder: '8001234567890' },
  ],
  sport: [
    { key: 'marca', label: 'Marca', type: 'text' },
    { key: 'tipo_prodotto', label: 'Tipo di prodotto', type: 'text', placeholder: 'Es. Scarpe running, Tappetino, Manubri' },
    { key: 'taglia', label: 'Taglia', type: 'text', placeholder: 'Es. M, 42, Unica', variantable: true },
    { key: 'colore', label: 'Colore', type: 'text', variantable: true },
    { key: 'tipo_attivita', label: 'Attività', type: 'select', options: ['Running', 'Yoga', 'Palestra', 'Calcio', 'Tennis', 'Trekking', 'Ciclismo', 'Nuoto', 'Outdoor', 'Fitness', 'Altro'] },
    { key: 'genere', label: 'Genere', type: 'select', options: ['Donna', 'Uomo', 'Unisex', 'Bambino'] },
    { key: 'livello', label: 'Livello', type: 'select', options: ['Principiante', 'Intermedio', 'Avanzato', 'Professionale'] },
    { key: 'materiale', label: 'Materiale', type: 'text', placeholder: 'Es. Poliestere tecnico, neoprene' },
    { key: 'peso', label: 'Peso', type: 'text', placeholder: 'Es. 250g, 5 kg' },
    { key: 'dimensioni', label: 'Dimensioni', type: 'text', placeholder: 'Es. 180x60 cm' },
    { key: 'ean', label: 'Codice EAN', type: 'text', placeholder: '8001234567890' },
  ],
};

/**
 * Mappa le chiavi attributo generiche estratte/proposte dall'AI sulle key
 * per-categoria. Sorgente unica, riusata da ProductForm (apply lato form) e
 * dal resolver server-side del patch AI (lib/products/aiPatch).
 */
export const AI_ATTR_TO_FIELD: Record<string, string> = {
  marca: 'marca', modello: 'modello', colore: 'colore', taglia: 'taglia',
  materiale: 'materiale', peso: 'peso', dimensioni: 'dimensioni',
  origine: 'origine', allergeni: 'allergeni', ingredienti: 'ingredienti',
  scadenza: 'scadenza', ean: 'ean', autore: 'autore', editore: 'editore',
  anno: 'anno', pagine: 'pagine', lingua: 'lingua', isbn: 'isbn', formato: 'formato',
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

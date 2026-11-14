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
  /**
   * 22/8/2026 — CAMPO CHE NON SI PUO' LASCIARE VUOTO.
   *
   * Un prodotto alimentare si poteva pubblicare e vendere senza dichiarare gli
   * allergeni. Non e' un dettaglio di completezza: il regolamento europeo
   * 1169/2011 impone che l'informazione sugli allergeni sia disponibile PRIMA
   * dell'acquisto anche nella vendita a distanza, e per chi e' allergico e'
   * la differenza fra una spesa e un ricovero.
   *
   * Chi vende un prodotto senza allergeni scrive «Nessuno dei 14 allergeni»:
   * e' una dichiarazione, non un campo lasciato in bianco — e la differenza fra
   * le due cose e' esattamente il punto.
   */
  required?: boolean;
};

/** Il valore da scegliere quando un alimento non contiene allergeni. */
export const NESSUN_ALLERGENE = 'Nessuno dei 14 allergeni';

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
    {
      key: 'allergeni',
      label: 'Allergeni',
      type: 'text',
      required: true,
      placeholder: 'Es. Glutine, lattosio, frutta a guscio',
      helpText: `Obbligatorio. Se il prodotto non ne contiene nessuno, scrivi «${NESSUN_ALLERGENE}».`,
    },
    { key: 'ingredienti', label: 'Ingredienti', type: 'textarea', required: true, placeholder: 'Lista degli ingredienti' },
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
/**
 * 28/10/2026 — Le bozze nate dalla foto salvano le caselle sì/no come testo («true»/«false»).
 * `Boolean("false")` è vero: il negozio vedeva spuntata la casella sbagliata e il cliente leggeva
 * «Vegano false». Qui il sì/no si legge in un punto solo, per il testo come per il booleano.
 */
export function attributoSpuntato(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const parola = value.trim().toLowerCase();
    return parola === '1' || PAROLE_DEL_SI.has(parola);
  }
  return false;
}

/**
 * 29/10/2026 — UNA regola sola per il sì/no, letta da casella del negoziante, marchio di qualità
 * («Bio», «Cruelty free»), griglia «Caratteristiche» e proposta dell'assistente. Prima erano
 * quattro: la casella capiva solo «true», il marchio anche «sì»/«yes»/«1», e il cliente vedeva
 * il marchio su una casella che il negozio trovava vuota. Tutto ciò che non è un sì è un no
 * («false», «no», «0», false, vuoto): la riparazione di «Vegano false» resta valida.
 */
// 5/11/2026 — anche «sí» con l'accento acuto (la tastiera del telefono lo propone): prima casella e
// marchio lo leggevano come un no, mentre la griglia lo scriveva così com'era.
const PAROLE_DEL_SI: ReadonlySet<string> = new Set(['true', 'sì', 'sí', 'si', 'yes', 'vero']);
/**
 * Le parole che la griglia scrive «No». Le cifre («1», «0») restano cifre nella griglia, perché
 * lì non si sa se «1» è una casella o «1 anno di garanzia»: per questo l'assistente salva le
 * caselle come booleano (`resolveAiPatch`, `pianoPatchPerIlModulo`).
 */
const PAROLE_DEL_NO: ReadonlySet<string> = new Set(['false', 'no', 'falso']);

/**
 * Chiavi salvate negli attributi che NON sono caratteristiche del prodotto: `alt_text` è la
 * descrizione della foto per chi non vede, già usata come testo alternativo dell'immagine.
 */
export const CHIAVI_FUORI_DALLA_GRIGLIA: readonly string[] = Object.freeze(['alt_text']);

/** Il tipo del campo con questa chiave, se è uno dei campi conosciuti. */
export function tipoDelCampo(key: string): AttributeFieldType | null {
  for (const fields of Object.values(CATEGORY_ATTRIBUTES)) {
    const f = fields.find((field) => field.key === key);
    if (f) return f.type;
  }
  return null;
}

/**
 * 5/11/2026 — Con la chiave la griglia conosce il tipo del campo: una casella si scrive Sì/No con
 * la stessa regola di casella e marchio (`attributoSpuntato`: anche «1», «0», «sí»), un campo di
 * testo resta com'è (un allergene «no» non diventa «No», un «yes» non diventa «Sì»). Senza chiave
 * resta il comportamento di prima.
 */
export function formatAttributeValue(value: unknown, key?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const tipo = key ? tipoDelCampo(key) : null;
  if (tipo === 'checkbox') return attributoSpuntato(value) ? 'Sì' : 'No';
  if (typeof value === 'boolean') return value ? 'Sì' : 'No';
  if (typeof value === 'string' && !tipo) {
    const parola = value.trim().toLowerCase();
    if (PAROLE_DEL_NO.has(parola)) return 'No';
    if (PAROLE_DEL_SI.has(parola)) return 'Sì';
  }
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

/**
 * 12/11/2026 (R12-023) — L'OBBLIGO SEGUE LA CATEGORIA, NON IL SUO NOME.
 *
 * I campi si sceglievano solo dallo slug della radice: bastava creare dal
 * pannello una radice «gastronomia» (o rinominare «alimentari») perché il
 * negoziante del pane non vedesse più Allergeni e Ingredienti, e il database
 * glielo lasciasse pubblicare. Ora una radice con
 * `richiede_dichiarazioni_alimentari` (migrazione 363) porta i campi degli
 * alimenti qualunque sia il suo nome. Chi passa categorie senza la colonna
 * (database prima della 363) ricade sul nome, come prima.
 */
type CategoriaPerAttributi = {
  id: string;
  slug: string;
  parent_id: string | null;
  richiede_dichiarazioni_alimentari?: boolean | null;
};

export function getAttributesForCategory(
  categories: Array<CategoriaPerAttributi>,
  categoryId: string | null | undefined,
): { fields: AttributeField[]; topSlug: string | null } {
  if (!categoryId) return { fields: [], topSlug: null };
  let cur = categories.find((c) => c.id === categoryId);
  // Collaudo K03: l'obbligo vale se lo porta la categoria o uno qualunque dei padri
  // (come il guardiano del database), non solo la radice.
  let obbligoAlimentare = cur?.richiede_dichiarazioni_alimentari === true;
  // Risali fino al livello top. R18-014 — con l'insieme dei già visti: un cerchio nei dati
  // (A→B→A) non deve far girare il modulo prodotto per sempre. Ogni passo va solo verso una
  // categoria mai vista, quindi la risalita finisce. Nessun tetto fisso di passi (giro di
  // correzione): un tetto di 20 perdeva l'obbligo alimentare oltre il ventunesimo livello.
  const visti = new Set<string>([cur?.id ?? '']);
  while (cur?.parent_id) {
    const parent: CategoriaPerAttributi | undefined = categories.find((c) => c.id === cur!.parent_id);
    if (!parent || visti.has(parent.id)) break;
    visti.add(parent.id);
    cur = parent;
    if (cur.richiede_dichiarazioni_alimentari === true) obbligoAlimentare = true;
  }
  if (!cur) return { fields: [], topSlug: null };
  if (obbligoAlimentare) {
    return { fields: CATEGORY_ATTRIBUTES.alimentari, topSlug: cur.slug };
  }
  return { fields: CATEGORY_ATTRIBUTES[cur.slug] ?? [], topSlug: cur.slug };
}

/**
 * I campi obbligatori della categoria che nel dato sono vuoti (etichette).
 * Un testo fatto solo di spazi conta come vuoto, come nel guardiano del database.
 */
export function campiObbligatoriMancanti(
  fields: readonly AttributeField[],
  attributes: Record<string, unknown> | null | undefined,
): string[] {
  const attr = attributes ?? {};
  return fields
    .filter((f) => f.required)
    .filter((f) => {
      const v = attr[f.key];
      if (v === null || v === undefined) return true;
      if (typeof v === 'string') return v.trim() === '';
      if (Array.isArray(v)) return v.length === 0;
      return false;
    })
    .map((f) => f.label);
}

/**
 * Lo stato con cui nasce un prodotto caricato da file.
 * Il caricamento da file salta il modulo, quindi salta anche i suoi controlli:
 * un prodotto a cui manca un campo obbligatorio della sua categoria (per gli
 * alimentari: Allergeni e Ingredienti, Reg. UE 1169/2011) nasce BOZZA, non in
 * vendita. Il negoziante lo completa dal modulo e lo pubblica da li.
 */
export function statoAlCaricamentoDaFile(
  categories: Array<CategoriaPerAttributi>,
  categoryId: string | null | undefined,
  attributes: Record<string, unknown> | null | undefined,
): { status: 'available' | 'draft'; mancanti: string[] } {
  const { fields } = getAttributesForCategory(categories, categoryId);
  const mancanti = campiObbligatoriMancanti(fields, attributes);
  return { status: mancanti.length > 0 ? 'draft' : 'available', mancanti };
}

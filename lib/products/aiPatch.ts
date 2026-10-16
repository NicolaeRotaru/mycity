// lib/products/aiPatch.ts
import {
  getAttributesForCategory,
  findLabelForKey,
  AI_ATTR_TO_FIELD,
} from '@/lib/category-attributes';
import {
  PRODUCT_UNITS,
  SELLER_STATUSES,
  normalizeCondition,
  type ProductCondition,
  type ProductUnit,
} from '@/lib/products/schema';

/**
 * Risoluzione server-side del patch proposto dall'assistente AI in un payload
 * di UPDATE per la tabella `products`.
 *
 * È il gemello server di `applyPatch` in ProductForm: stesse regole (categoria
 * a due livelli, attributi validati contro lo schema della categoria effettiva,
 * tag come lista completa, condizione/compare_at_price annullabili), ma invece
 * di scrivere nello stato di un form produce l'oggetto `update` da passare a
 * Supabase. Vive qui — non in una route — così è testabile in isolamento e
 * condiviso tra la chat catalogo e l'eventuale apply.
 *
 * Sicurezza: NON tocca mai `seller_id`, `images` o colonne esterne; valida ogni
 * campo prima di includerlo. I valori liberi che non passano la validazione
 * vengono semplicemente ignorati (mai scritti).
 */

export type AiProductPatch = {
  name?: string;
  description?: string;
  price?: number;
  compare_at_price?: number | null;
  unit?: string;
  condition?: string | null;
  stock?: number;
  unlimited_stock?: boolean;
  category_slug?: string;
  subcategory_name?: string;
  tags?: string[];
  attributes?: Record<string, string>;
  attributes_remove?: string[];
  status?: string;
};

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
};

export type CurrentProduct = {
  attributes: Record<string, unknown> | null;
  category_id: string | null;
  has_variants?: boolean | null;
  /** 192 — serve alla banda di sicurezza sul prezzo: senza il valore attuale
   *  non si puo' dire se una proposta e' ragionevole o un errore di battitura
   *  del modello. Assente = nessuna banda, come prima. */
  price?: number | string | null;
};

export type ResolvedPatch = {
  /** Colonne da scrivere su `products` (vuoto = niente da cambiare). */
  update: Record<string, unknown>;
  /** Etichette in italiano dei campi modificati (feedback in chat). */
  changed: string[];
  /**
   * R41 — Le etichette dei campi dichiarativi che l'assistente voleva scrivere
   * o togliere e che NON sono stati toccati (es. «Allergeni»). Vuoto se il
   * patch non ne conteneva.
   */
  protetti: string[];
};

/**
 * 15/10/2026 (R41) — LE DICHIARAZIONI DI UN ALIMENTO LE FA IL NEGOZIANTE, MAI L'AI.
 *
 * Allergeni, ingredienti, valori nutrizionali e le caselle «senza glutine»,
 * «senza lattosio», «vegano», «bio», piu' origine e scadenza non sono testo da
 * migliorare: sono la dichiarazione che il regolamento europeo 1169/2011 chiede
 * a chi vende un alimento, PRIMA dell'acquisto, anche a distanza. Chi e'
 * allergico al latte legge quella riga e decide se mangiare.
 *
 * Il lavoro massivo «Migliora tutto» manda al modello solo il testo della
 * scheda — niente foto, niente etichetta — e gli chiedeva di compilare «gli
 * attributi mancanti». Questo risolutore scriveva qualunque attributo valido
 * per la categoria, anche sopra quello che il negoziante aveva dichiarato a
 * mano. Una focaccia con «Glutine, sesamo, latte» poteva tornare in vetrina con
 * «Glutine» e la casella «Senza lattosio» spuntata, indovinati dal nome.
 *
 * La lista e' UNA, e la leggono tutte le strade da cui l'AI scrive un prodotto:
 * il risolutore del server (chat Assistenza, Catalog Copilot, lavoro massivo) e
 * il filtro del modulo (migliora, diagnosi, chat del prodotto, voce, codice a
 * barre). Vale sia per SCRIVERE sia per TOGLIERE: un allergene cancellato e'
 * una dichiarazione sbagliata quanto uno inventato.
 *
 * L'unica strada che resta aperta e' la lettura dell'etichetta in foto
 * (`/api/vision/extract-product`), e anche li' il valore arriva davanti agli
 * occhi del negoziante prima di diventare una scheda: nel modulo come campo da
 * salvare, nella chat Assistenza come riquadro da confermare.
 */
export const CAMPI_DICHIARATIVI = [
  'allergeni',
  'ingredienti',
  'valori_nutrizionali',
  'senza_glutine',
  'senza_lattosio',
  'vegano',
  'bio',
  'origine',
  'scadenza',
] as const;

/** La chiave del campo di categoria a cui punta una chiave proposta dall'AI. */
function chiaveCampo(chiaveAi: string): string {
  const norm = String(chiaveAi).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return AI_ATTR_TO_FIELD[norm] ?? norm;
}

/** Vero se la chiave (anche scritta come la scrive il modello) e' una dichiarazione. */
export function eCampoDichiarativo(chiaveAi: string): boolean {
  return (CAMPI_DICHIARATIVI as readonly string[]).includes(chiaveCampo(chiaveAi));
}

export type DichiarazioneScartata = {
  chiave: string;
  etichetta: string;
  azione: 'scrivi' | 'togli';
  /** Il valore che l'AI proponeva (solo per «scrivi»). */
  valore?: string;
};

/**
 * Toglie dal patch ogni campo dichiarativo, in scrittura (`attributes`) e in
 * rimozione (`attributes_remove`), e dice quali ha tolto. Un `attributes` o un
 * `attributes_remove` rimasti vuoti spariscono del tutto: un patch che
 * conteneva solo allergeni diventa un patch vuoto, non «una modifica».
 */
export function separaCampiDichiarativi<T extends object>(
  patch: T,
): { patch: T; scartati: DichiarazioneScartata[] } {
  const scartati: DichiarazioneScartata[] = [];
  const sorgente = patch as Record<string, unknown>;
  let fuori: Record<string, unknown> | null = null;

  const attrs = sorgente.attributes;
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
    const tenuti: Record<string, unknown> = {};
    let tolto = false;
    for (const [k, v] of Object.entries(attrs as Record<string, unknown>)) {
      if (!eCampoDichiarativo(k)) {
        tenuti[k] = v;
        continue;
      }
      tolto = true;
      const valore = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
      if (valore) {
        const chiave = chiaveCampo(k);
        scartati.push({ chiave, etichetta: findLabelForKey(chiave), azione: 'scrivi', valore });
      }
    }
    if (tolto) {
      fuori = { ...sorgente };
      if (Object.keys(tenuti).length > 0) fuori.attributes = tenuti;
      else delete fuori.attributes;
    }
  }

  const via = sorgente.attributes_remove;
  if (Array.isArray(via)) {
    const tenute = via.filter((k) => !eCampoDichiarativo(String(k)));
    if (tenute.length !== via.length) {
      for (const k of via) {
        if (!eCampoDichiarativo(String(k))) continue;
        const chiave = chiaveCampo(String(k));
        scartati.push({ chiave, etichetta: findLabelForKey(chiave), azione: 'togli' });
      }
      fuori = fuori ?? { ...sorgente };
      if (tenute.length > 0) fuori.attributes_remove = tenute;
      else delete fuori.attributes_remove;
    }
  }

  return { patch: (fuori ?? sorgente) as T, scartati };
}

/**
 * Il messaggio quando la modifica dell'assistente chiedeva SOLO di cambiare
 * dichiarazioni. Resta sotto i 200 caratteri anche con tutti e nove i campi:
 * sopra, la chat lo passa da `friendlyError`, che lo sostituisce con «Qualcosa
 * non ha funzionato. Riprova» — proprio il «Riprova» inutile da togliere
 * (collaudo del 15/10: con nove campi erano 213 caratteri).
 */
export function messaggioDichiarazioniProtette(etichette: string[]): string {
  // «Valori nutrizionali (per 100g)»: `friendlyError` toglie cio' che sta fra
  // parentesi, quindi qui il nome si accorcia prima.
  const nomi = etichette.map((e) => e.replace(/\s*\(.*?\)/g, '').trim()).filter(Boolean);
  const coda = ": non li cambia l'assistente. Li scrivi tu nella scheda del prodotto, col pulsante «Apri».";
  const MAX = 190;
  for (let n = nomi.length; n >= 1; n--) {
    const resto = nomi.length - n;
    const elenco = nomi.slice(0, n).join(', ') + (resto > 0 ? ` e altri ${resto} campi` : '');
    if (elenco.length + coda.length <= MAX) return elenco + coda;
  }
  return `${nomi.length} campi${coda}`;
}

/** Il motivo, scritto come lo legge il negoziante. */
export function motivoDichiarazioneRifiutata(s: DichiarazioneScartata): string {
  return s.azione === 'togli'
    ? `${s.etichetta} NON tolto: lo decidi tu nella scheda del prodotto`
    : `${s.etichetta} NON compilato dall'assistente: lo scrivi tu nella scheda (proposta: «${s.valore ?? ''}»)`;
}

/**
 * La riga da dare al modello, la stessa per tutti i prompt che propongono
 * modifiche a un prodotto. Il freno vero sta in `separaCampiDichiarativi`:
 * questa riga serve solo a non far proporre quello che poi verrebbe scartato.
 */
export const REGOLA_CAMPI_DICHIARATIVI = `CAMPI CHE NON TOCCHI MAI: ${CAMPI_DICHIARATIVI.join(', ')}. Sono la dichiarazione del venditore su un alimento (allergeni, ingredienti e simili): non compilarli, non cambiarli e non toglierli, nemmeno se ti sembrano ovvi dal nome o dalla foto. Se mancano, dillo al venditore e lascia che li scriva lui nella scheda del prodotto.`;

/** Risolve slug categoria (+ nome sottocategoria) → category_id a due livelli. */
function resolveCategoryId(
  categories: CategoryRow[],
  slug: string,
  subName?: string,
): string | null {
  const top = categories.find((c) => !c.parent_id && c.slug === slug);
  if (!top) return null;
  if (subName) {
    const norm = subName.trim().toLowerCase();
    const sub = categories.find(
      (c) => c.parent_id === top.id && c.name.toLowerCase() === norm,
    );
    if (sub) return sub.id;
  }
  return top.id;
}

/**
 * 27/8/2026 (R145) — LA BANDA SUL PREZZO, IN UN POSTO SOLO.
 *
 * Stava dentro `resolveAiPatch`, cioe' solo sulla strada del server: i
 * suggerimenti che tornano al browser (migliora tutto, diagnosi, chat sul
 * prodotto, testo per Google, traduzione, codice a barre) li applicava il
 * modulo del prodotto, che sul prezzo non guardava niente. Uno zero perso dal
 * modello — 20 € che diventano 2 € — entrava in vetrina.
 *
 * Sopra questa soglia la decisione e' del negoziante, non del modello: il
 * prezzo non si applica e non si tronca nemmeno. Troncare avrebbe scritto
 * comunque un prezzo che nessuno ha deciso.
 */
export const BANDA_PREZZO_AI = 0.30;

/**
 * 30/8/2026 (R158) — LA MISURA DEL NOME E DELLA DESCRIZIONE, IN UN POSTO SOLO.
 *
 * Chi CREA un prodotto dalle foto tronca da sempre (`draftFromVision`); chi lo
 * MODIFICA — questa funzione — accettava qualunque lunghezza col solo controllo
 * «stringa non vuota» e la scriveva nel database, dove le due colonne sono
 * `text` senza vincolo. Un nome di diecimila caratteri entrava in vetrina, nei
 * risultati di ricerca, nelle email di conferma e nella pagina pubblica del
 * negozio.
 *
 * I due numeri stavano scritti a mano dentro `draftFromVision`. Adesso stanno
 * qui e li leggono tutte e due le strade, piu' il vincolo sulla tabella
 * (migrazione 149) che copre anche la scrittura diretta dal browser.
 */
export const MAX_NOME_PRODOTTO = 120;
export const MAX_DESCRIZIONE_PRODOTTO = 4000;

/** Vero se il prezzo proposto si scosta dall'attuale piu' della banda. */
export function prezzoAiFuoriBanda(
  proposto: number,
  attuale: number | string | null | undefined,
): boolean {
  const partenza = Number(attuale ?? 0);
  if (!(partenza > 0)) return false; // prodotto nuovo: non c'e' niente da confrontare
  return Math.abs(proposto - partenza) / partenza > BANDA_PREZZO_AI;
}

/** Il motivo, scritto come lo legge il negoziante. */
export function motivoPrezzoRifiutato(proposto: number, attuale: number | string | null | undefined): string {
  const partenza = Number(attuale ?? 0);
  return `prezzo NON applicato (${partenza.toFixed(2)} → ${proposto.toFixed(2)} €: oltre il ${Math.round(
    BANDA_PREZZO_AI * 100,
  )}%, va deciso a mano)`;
}

/**
 * Il filtro che il MODULO del prodotto passa sopra ogni suggerimento prima di
 * scriverlo nei campi. Toglie quello che non deve entrare — il prezzo fuori
 * banda e (R41) i campi dichiarativi di un alimento — e restituisce i motivi da
 * mostrare, con le stesse parole del server. Il valore dichiarativo proposto
 * resta scritto nel motivo: il negoziante lo vede e, se e' giusto, lo copia lui.
 */
export function patchAiPerIlForm<T extends { price?: number }>(
  patch: T,
  opts: { prezzoAttuale?: number | string | null },
): { patch: T; rifiutati: string[]; proposte: PropostaDichiarativa[] } {
  const rifiutati: string[] = [];
  const { patch: senzaDichiarazioni, scartati } = separaCampiDichiarativi(patch);
  const proposte: PropostaDichiarativa[] = [];
  for (const s of scartati) {
    const motivo = motivoDichiarazioneRifiutata(s);
    rifiutati.push(motivo);
    if (s.azione === 'scrivi' && s.valore) proposte.push({ chiave: s.chiave, valore: s.valore, motivo });
  }
  if (
    typeof senzaDichiarazioni.price === 'number' &&
    senzaDichiarazioni.price > 0 &&
    prezzoAiFuoriBanda(senzaDichiarazioni.price, opts.prezzoAttuale)
  ) {
    rifiutati.unshift(motivoPrezzoRifiutato(senzaDichiarazioni.price, opts.prezzoAttuale));
    const { price: _scartato, ...resto } = senzaDichiarazioni;
    return { patch: resto as T, rifiutati, proposte };
  }
  return { patch: senzaDichiarazioni, rifiutati, proposte };
}

/** Una dichiarazione che l'assistente proponeva e che nel modulo NON e' entrata. */
export type PropostaDichiarativa = { chiave: string; valore: string; motivo: string };

/**
 * R41 — Nel modulo, la dichiarazione proposta dall'assistente diventa una
 * PROPOSTA da confermare a mano: un avviso col valore e un pulsante «Usa questo
 * valore». Il campo si riempie solo se il negoziante lo preme, e anche allora
 * resta davanti ai suoi occhi fino al salvataggio.
 *
 * Qui si decide se il pulsante c'e' e cosa scrive: c'e' solo se il campo esiste
 * nella categoria del prodotto (un'«Allergeni» proposta per un tagliere non ha
 * dove andare), e una casella diventa vero o falso come quando la compila la
 * lettura della foto.
 */
export function propostaPerIlModulo(
  proposta: PropostaDichiarativa,
  campi: { key: string; type: string }[],
): { motivo: string; valore?: string | boolean } {
  const campo = campi.find((f) => f.key === proposta.chiave);
  if (!campo) return { motivo: proposta.motivo };
  const valore =
    campo.type === 'checkbox' ? /^(true|1|s[iì]|yes|vero)$/i.test(proposta.valore.trim()) : proposta.valore.trim();
  return { motivo: proposta.motivo, valore };
}

/**
 * Una scrittura che il modulo del prodotto fa nel suo stato. `etichetta` e' il
 * nome del campo come lo legge il negoziante.
 */
export type ScritturaModulo =
  | { campo: 'name' | 'description'; valore: string; etichetta: string }
  | { campo: 'price'; valore: number; etichetta: string }
  /** `valore: null` svuota il prezzo pieno barrato. */
  | { campo: 'compareAtPrice'; valore: number | null; etichetta: string }
  | { campo: 'unit'; valore: ProductUnit; etichetta: string }
  | { campo: 'condition'; valore: ProductCondition | ''; etichetta: string }
  /** `valore: null` = disponibilita' illimitata. */
  | { campo: 'stock'; valore: number | null; etichetta: string }
  | { campo: 'category_id'; valore: string; etichetta: string }
  | { campo: 'tags'; valore: string[]; etichetta: string }
  /** `valore: ''` toglie l'attributo. */
  | { campo: 'attributo'; chiave: string; valore: string; etichetta: string }
  | { campo: 'status'; valore: string; etichetta: string };

export type PianoPatchModulo = {
  /** Il patch dopo i filtri: e' cio' che puo' entrare nei campi. */
  patch: AiProductPatch;
  /** Cosa il modulo scrive, nell'ordine. */
  scritture: ScritturaModulo[];
  /**
   * Le etichette dei campi che il modulo scrive DAVVERO, una per scrittura.
   * Vuoto = nel modulo non e' cambiato niente, e nessuno deve dire «aggiornato».
   */
  cambiati: string[];
  /** Cio' che non entra e si dice con un avviso semplice (es. prezzo fuori banda). */
  avvisi: string[];
  /** Le dichiarazioni proposte: avviso lungo, col valore da usare se il campo esiste. */
  proposte: { chiave: string; motivo: string; valore?: string | boolean }[];
  /**
   * Il pezzo del suggerimento che il modulo non scrive MAI — le dichiarazioni
   * (allergeni, ingredienti…) da scrivere o da togliere — rimesso in forma di
   * patch. Ripassato al modulo riapre gli stessi avvisi, col pulsante «Usa
   * questo valore», e non scrive niente: serve a ritrovare la proposta quando
   * l'avviso a tempo e' sparito. Vuoto = non c'e' niente da rivedere.
   */
  daRivedere: AiProductPatch;
};

/**
 * Le dichiarazioni del suggerimento, rimesse in forma di patch con la chiave del
 * campo. Escono dallo stesso `separaCampiDichiarativi` che le toglie dal modulo:
 * quello che c'e' qui, il modulo non lo scrive per costruzione.
 */
function dichiarazioniDaRivedere(proposta: AiProductPatch): AiProductPatch {
  const { scartati } = separaCampiDichiarativi(proposta);
  const attributi: Record<string, string> = {};
  const daTogliere: string[] = [];
  for (const s of scartati) {
    if (s.azione === 'scrivi' && s.valore) attributi[s.chiave] = s.valore;
    else if (s.azione === 'togli' && !daTogliere.includes(s.chiave)) daTogliere.push(s.chiave);
  }
  const fuori: AiProductPatch = {};
  if (Object.keys(attributi).length > 0) fuori.attributes = attributi;
  if (daTogliere.length > 0) fuori.attributes_remove = daTogliere;
  return fuori;
}

/**
 * 16/10/2026 — IL MODULO DICE «AGGIORNATO» SOLO SE HA SCRITTO QUALCOSA.
 *
 * Il negoziante scrive nella chat del prodotto «aggiungi gli allergeni:
 * glutine». Il patch e' fatto solo di allergeni, che nel modulo non entrano
 * (R41): diventano una proposta col pulsante «Usa questo valore». Ma il modulo
 * contava come «campo aggiornato» anche ogni proposta scartata, e la chat
 * mostrava insieme la spunta verde «Campi aggiornati nel form» e l'avviso
 * «Allergeni NON compilato». Chi si fidava del verde salvava un prodotto senza
 * allergeni. Lo stesso con la diagnosi, «migliora», la voce e il codice a barre,
 * e — da prima — con un patch fatto solo di un prezzo fuori banda.
 *
 * Qui si decide, senza toccare lo stato del modulo, cosa il modulo scrive e cosa
 * dice. `cambiati` nasce dalle scritture e da nient'altro; quello che non entra
 * va in `avvisi` o in `proposte`, che il modulo mostra a parte. Le regole sui
 * campi sono quelle che il modulo applicava gia'.
 */
export function pianoPatchPerIlModulo(
  proposta: AiProductPatch,
  ctx: {
    prezzoAttuale?: number | string | null;
    categorie: CategoryRow[];
    categoriaAttuale: string | null | undefined;
    modo: 'create' | 'edit';
  },
): PianoPatchModulo {
  const { patch, rifiutati, proposte } = patchAiPerIlForm(proposta, { prezzoAttuale: ctx.prezzoAttuale });
  const motiviConProposta = new Set(proposte.map((p) => p.motivo));
  const avvisi = rifiutati.filter((m) => !motiviConProposta.has(m));
  const scritture: ScritturaModulo[] = [];

  if (typeof patch.name === 'string' && patch.name.trim()) {
    scritture.push({ campo: 'name', valore: patch.name.trim(), etichetta: 'nome' });
  }
  if (typeof patch.description === 'string' && patch.description.trim()) {
    scritture.push({ campo: 'description', valore: patch.description.trim(), etichetta: 'descrizione' });
  }
  if (typeof patch.price === 'number' && patch.price > 0) {
    scritture.push({ campo: 'price', valore: patch.price, etichetta: 'prezzo' });
  }
  if ('compare_at_price' in patch) {
    if (patch.compare_at_price == null) {
      scritture.push({ campo: 'compareAtPrice', valore: null, etichetta: 'prezzo pieno' });
    } else if (typeof patch.compare_at_price === 'number' && patch.compare_at_price > 0) {
      scritture.push({ campo: 'compareAtPrice', valore: patch.compare_at_price, etichetta: 'prezzo pieno' });
    }
  }
  if (patch.unit && (PRODUCT_UNITS as readonly string[]).includes(patch.unit)) {
    scritture.push({ campo: 'unit', valore: patch.unit as ProductUnit, etichetta: 'unità' });
  }
  if ('condition' in patch) {
    const valore = patch.condition == null ? '' : normalizeCondition(String(patch.condition));
    scritture.push({ campo: 'condition', valore, etichetta: 'condizione' });
  }
  if (patch.unlimited_stock === true) {
    scritture.push({ campo: 'stock', valore: null, etichetta: 'disponibilità' });
  } else if (typeof patch.stock === 'number' && patch.stock >= 0) {
    scritture.push({ campo: 'stock', valore: Math.trunc(patch.stock), etichetta: 'disponibilità' });
  }

  // Categoria → slug/sottocategoria su category_id. Gli attributi si validano
  // contro la categoria EFFETTIVA (quella dopo il cambio).
  let categoriaEffettiva = ctx.categoriaAttuale ?? null;
  if (patch.category_slug) {
    const risolta = resolveCategoryId(ctx.categorie, patch.category_slug, patch.subcategory_name);
    if (risolta) {
      scritture.push({ campo: 'category_id', valore: risolta, etichetta: 'categoria' });
      categoriaEffettiva = risolta;
    }
  }

  if (Array.isArray(patch.tags)) {
    const next: string[] = [];
    for (const raw of patch.tags) {
      const t = String(raw).trim().toLowerCase().replace(/,+$/, '');
      if (t && !next.includes(t) && next.length < 15) next.push(t);
    }
    scritture.push({ campo: 'tags', valore: next, etichetta: 'tag' });
  }

  const { fields } = getAttributesForCategory(ctx.categorie, categoriaEffettiva);
  if (patch.attributes && typeof patch.attributes === 'object') {
    for (const [aiKey, rawValue] of Object.entries(patch.attributes)) {
      const value = typeof rawValue === 'string' ? rawValue.trim() : '';
      if (!value) continue;
      const targetKey = AI_ATTR_TO_FIELD[aiKey] ?? aiKey;
      const field = fields.find((f) => f.key === targetKey);
      if (!field) continue;
      if (field.type === 'select' && !(field.options ?? []).includes(value)) continue;
      scritture.push({ campo: 'attributo', chiave: targetKey, valore: value, etichetta: field.label });
    }
  }
  if (Array.isArray(patch.attributes_remove)) {
    for (const key of patch.attributes_remove) {
      const targetKey = AI_ATTR_TO_FIELD[key] ?? key;
      scritture.push({ campo: 'attributo', chiave: targetKey, valore: '', etichetta: `rimosso ${targetKey}` });
    }
  }

  if (ctx.modo === 'edit' && patch.status && (SELLER_STATUSES as readonly string[]).includes(patch.status)) {
    scritture.push({ campo: 'status', valore: patch.status, etichetta: 'stato' });
  }

  return {
    patch,
    scritture,
    cambiati: scritture.map((s) => s.etichetta),
    avvisi,
    proposte: proposte.map((p) => ({ chiave: p.chiave, ...propostaPerIlModulo(p, fields) })),
    daRivedere: dichiarazioniDaRivedere(proposta),
  };
}

/**
 * Quello che il modulo del prodotto restituisce a chi gli ha passato un
 * suggerimento («Migliora tutto», la diagnosi, la voce, la chat, il codice a
 * barre).
 */
export type EsitoPatchModulo = {
  /** Le etichette dei campi scritti davvero. Vuoto = nella scheda non e' cambiato niente. */
  cambiati: string[];
  /**
   * Quanti avvisi il modulo ha appena aperto per cose rimaste da decidere a
   * mano: una dichiarazione proposta, un prezzo fuori banda, una dichiarazione
   * che l'assistente voleva togliere. Uno per avviso.
   */
  inSospeso: number;
  /** Vedi `PianoPatchModulo.daRivedere`. */
  daRivedere: AiProductPatch;
};

/** L'esito di un piano, per chi chiama il modulo. */
export function esitoDelPiano(piano: PianoPatchModulo): EsitoPatchModulo {
  return {
    cambiati: piano.cambiati,
    inSospeso: piano.avvisi.length + piano.proposte.length,
    daRivedere: piano.daRivedere,
  };
}

/** Vero se nel suggerimento resta qualcosa da rivedere (vedi `daRivedere`). */
export function restaDaRivedere(patch: AiProductPatch | null | undefined): boolean {
  return !!patch && Object.keys(patch).length > 0;
}

export type AvvisoDopoIlPatch = {
  /** `successo` = avviso verde · `da-controllare` = avviso giallo · `neutro` = avviso semplice. */
  tono: 'successo' | 'da-controllare' | 'neutro';
  testo: string;
};

/**
 * 16/10/2026 — «LA SCHEDA E' GIA' A POSTO» ACCANTO A «ALLERGENI NON COMPILATO».
 *
 * Il fornaio apre la focaccia (5 €) e preme «Migliora tutto». L'assistente
 * propone gli allergeni «Glutine»: nel modulo non entrano (R41), diventano un
 * avviso col pulsante «Usa questo valore». Il modulo non ha scritto niente, e
 * il pannello leggeva «niente scritto» come «niente da fare»: diceva «Niente da
 * cambiare: la scheda e' gia' a posto» proprio mentre l'avviso chiedeva di
 * compilare gli allergeni. Lo stesso con un prezzo di 50 € scartato, e con la
 * diagnosi («Niente da applicare»).
 *
 * Qui si decide la frase che segue l'applicazione di un suggerimento, la stessa
 * per tutti i pulsanti dell'assistente. Ognuno porta le sue due frasi — quella
 * per «ho scritto» e quella per «non c'era niente» — e la terza, «ci sono
 * proposte da controllare», e' comune: quando restano avvisi aperti, la frase
 * «niente da fare» non esce mai.
 */
export function avvisoDopoIlPatch(
  esito: Pick<EsitoPatchModulo, 'cambiati' | 'inSospeso'>,
  testi: { applicato: string; niente: string },
): AvvisoDopoIlPatch {
  const n = esito.inSospeso;
  if (esito.cambiati.length > 0) {
    if (n <= 0) return { tono: 'successo', testo: testi.applicato };
    const coda =
      n === 1
        ? "C'è anche una proposta da controllare: guarda l'avviso"
        : `Ci sono anche ${n} proposte da controllare: guarda gli avvisi`;
    return { tono: 'successo', testo: `${testi.applicato}. ${coda}` };
  }
  if (n > 0) {
    return {
      tono: 'da-controllare',
      testo:
        n === 1
          ? "C'è una proposta da controllare: guarda l'avviso"
          : `Ci sono ${n} proposte da controllare: guarda gli avvisi`,
    };
  }
  return { tono: 'neutro', testo: testi.niente };
}

export function resolveAiPatch(opts: {
  patch: AiProductPatch;
  current: CurrentProduct;
  categories: CategoryRow[];
}): ResolvedPatch {
  const { current, categories } = opts;
  const update: Record<string, unknown> = {};
  const changed: string[] = [];

  // R41 — Prima di tutto si tolgono le dichiarazioni: da qui in giu' il patch
  // non le contiene piu', ne' in scrittura ne' in rimozione.
  const { patch, scartati } = separaCampiDichiarativi(opts.patch);
  const protetti = Array.from(new Set(scartati.map((s) => s.etichetta)));
  for (const s of scartati) changed.push(motivoDichiarazioneRifiutata(s));

  if (typeof patch.name === 'string' && patch.name.trim()) {
    // R158 — Il taglio e' lo stesso che fa chi crea il prodotto dalle foto.
    update.name = patch.name.trim().slice(0, MAX_NOME_PRODOTTO);
    changed.push('nome');
  }
  if (typeof patch.description === 'string' && patch.description.trim()) {
    update.description = patch.description.trim().slice(0, MAX_DESCRIZIONE_PRODOTTO);
    changed.push('descrizione');
  }
  if (typeof patch.price === 'number' && patch.price > 0) {
    // 192 — Banda di sicurezza sul prezzo proposto dal modello. La regola sta
    // in `prezzoAiFuoriBanda`, e da li' la legge anche il modulo del prodotto
    // nel browser (R145): finche' era scritta solo qui, meta' dei suggerimenti
    // non ci passava.
    if (prezzoAiFuoriBanda(patch.price, current.price)) {
      changed.push(motivoPrezzoRifiutato(patch.price, current.price));
    } else {
      update.price = patch.price;
      changed.push('prezzo');
    }
  }
  if ('compare_at_price' in patch) {
    if (patch.compare_at_price == null) {
      update.compare_at_price = null;
      changed.push('prezzo pieno');
    } else if (typeof patch.compare_at_price === 'number' && patch.compare_at_price > 0) {
      update.compare_at_price = patch.compare_at_price;
      changed.push('prezzo pieno');
    }
  }
  if (patch.unit && (PRODUCT_UNITS as readonly string[]).includes(patch.unit)) {
    update.unit = patch.unit;
    changed.push('unità');
  }
  if ('condition' in patch) {
    if (patch.condition == null) {
      update.condition = null;
      changed.push('condizione');
    } else {
      const norm = normalizeCondition(String(patch.condition));
      update.condition = norm || null;
      changed.push('condizione');
    }
  }

  // Stock: ignorato sui prodotti con varianti (lo stock è la somma delle
  // varianti, riallineato dal trigger DB).
  if (!current.has_variants) {
    if (patch.unlimited_stock === true) {
      update.stock = null;
      changed.push('disponibilità');
    } else if (typeof patch.stock === 'number' && patch.stock >= 0) {
      update.stock = Math.trunc(patch.stock);
      changed.push('disponibilità');
    }
  }

  // Categoria → risolvi slug/sottocategoria su category_id. L'attributo
  // validation usa la categoria EFFETTIVA (post-cambio).
  let effectiveCategoryId = current.category_id ?? null;
  if (patch.category_slug) {
    const resolved = resolveCategoryId(categories, patch.category_slug, patch.subcategory_name);
    if (resolved) {
      update.category_id = resolved;
      effectiveCategoryId = resolved;
      changed.push('categoria');
    }
  }

  if (Array.isArray(patch.tags)) {
    const next: string[] = [];
    for (const raw of patch.tags) {
      const t = String(raw).trim().toLowerCase().replace(/,+$/, '');
      if (t && !next.includes(t) && next.length < 15) next.push(t);
    }
    update.tags = next;
    changed.push('tag');
  }

  // Attributi: parti dallo stato attuale e applica set/rimozioni, validando i
  // set contro i campi della categoria effettiva.
  const hasAttrSet = patch.attributes && typeof patch.attributes === 'object';
  const hasAttrRemove = Array.isArray(patch.attributes_remove) && patch.attributes_remove.length > 0;
  if (hasAttrSet || hasAttrRemove) {
    const merged: Record<string, unknown> = { ...(current.attributes ?? {}) };
    const { fields } = getAttributesForCategory(
      categories.map((c) => ({ id: c.id, slug: c.slug, parent_id: c.parent_id })),
      effectiveCategoryId,
    );
    if (hasAttrSet) {
      for (const [aiKey, rawValue] of Object.entries(patch.attributes!)) {
        const value = typeof rawValue === 'string' ? rawValue.trim() : '';
        if (!value) continue;
        const targetKey = AI_ATTR_TO_FIELD[aiKey] ?? aiKey;
        const field = fields.find((f) => f.key === targetKey);
        if (!field) continue;
        if (field.type === 'select' && !(field.options ?? []).includes(value)) continue;
        merged[targetKey] = value;
        changed.push(field.label);
      }
    }
    if (hasAttrRemove) {
      for (const key of patch.attributes_remove!) {
        const targetKey = AI_ATTR_TO_FIELD[key] ?? key;
        if (targetKey in merged) {
          delete merged[targetKey];
          changed.push(`rimosso ${targetKey}`);
        }
      }
    }
    update.attributes = merged;
  }

  if (patch.status && (SELLER_STATUSES as readonly string[]).includes(patch.status)) {
    update.status = patch.status;
    changed.push('stato');
  }

  return { update, changed, protetti };
}

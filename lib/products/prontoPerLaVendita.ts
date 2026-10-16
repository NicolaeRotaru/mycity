// lib/products/prontoPerLaVendita.ts
import {
  AI_ATTR_TO_FIELD,
  CATEGORY_ATTRIBUTES,
  findLabelForKey,
  formatAttributeValue,
  getAttributesForCategory,
} from '@/lib/category-attributes';
import {
  chiaveCampo,
  eCampoDichiarativo,
  prezzoAiFuoriBanda,
  separaCampiDichiarativi,
  voceComeTesto,
  type AiProductPatch,
  type CategoryRow,
  type DichiarazioneScartata,
} from '@/lib/products/aiPatch';
import { attributoCheEntra } from '@/lib/products/draftFromVision';
import { SELLER_STATUSES } from '@/lib/products/schema';
import { formatPrice } from '@/lib/format';

/**
 * 15/10/2026 (R36) — DALLA CHAT SI PUBBLICAVA SENZA I CONTROLLI DEL MODULO.
 *
 * Il modulo del prodotto, prima di mettere un prodotto in vendita, controlla
 * che ci siano una foto, un nome, una descrizione, un prezzo, una categoria e i
 * campi obbligatori della categoria — per gli alimentari Allergeni e
 * Ingredienti, che il regolamento europeo 1169/2011 vuole PRIMA dell'acquisto.
 *
 * La chat Assistenza aveva una strada sua: «pubblica» diventava una modifica
 * `status = available` che nessuno controllava. Un alimento creato dalle foto
 * andava in vendita con gli allergeni che il modello aveva dedotto e senza
 * ingredienti; se gli allergeni mancavano, il guardiano del database diceva
 * perche', ma la rotta buttava via il motivo e scriveva «Riprova» — e riprovare
 * dava sempre lo stesso errore.
 *
 * Qui stanno le stesse regole del modulo (in modifica: descrizione da 10
 * caratteri, come `createProductSchema` con `minDescription: 10`), scritte una
 * volta e lette dalle rotte che applicano le modifiche dell'assistente e dalla
 * chat che le propone.
 */

export const MIN_NOME_PER_VENDERE = 3;
export const MIN_DESCRIZIONE_PER_VENDERE = 10;

/** Quello che serve sapere di una scheda per dire se si puo' mettere in vendita. */
export type SchedaDaVendere = {
  name: string | null | undefined;
  description: string | null | undefined;
  price: number | string | null | undefined;
  /** Vero se il prodotto ha una categoria (anche una che non ha campi suoi). */
  haCategoria: boolean;
  /** Lo slug della categoria di PRIMO livello: da li' vengono i campi obbligatori. */
  categoriaTop: string | null | undefined;
  numeroFoto: number;
  attributes: Record<string, unknown> | null | undefined;
};

/** Le etichette dei campi obbligatori della categoria che sono vuoti. */
export function campiObbligatoriVuoti(
  categoriaTop: string | null | undefined,
  attributes: Record<string, unknown> | null | undefined,
): string[] {
  const campi = categoriaTop ? CATEGORY_ATTRIBUTES[categoriaTop] ?? [] : [];
  const attr = attributes ?? {};
  return campi.filter((f) => f.required && !String(attr[f.key] ?? '').trim()).map((f) => f.label);
}

/**
 * Cosa manca perche' la scheda si possa mettere in vendita, con le parole del
 * modulo. Vuoto = si puo'.
 */
export function cosaMancaPerVendere(s: SchedaDaVendere): string[] {
  const mancanti: string[] = [];
  if (!(s.numeroFoto > 0)) mancanti.push('una foto');
  if (String(s.name ?? '').trim().length < MIN_NOME_PER_VENDERE) mancanti.push('Nome');
  if (String(s.description ?? '').trim().length < MIN_DESCRIZIONE_PER_VENDERE) {
    mancanti.push(`Descrizione di almeno ${MIN_DESCRIZIONE_PER_VENDERE} caratteri`);
  }
  if (!(Number(s.price ?? 0) > 0)) mancanti.push('Prezzo');
  if (!s.haCategoria) mancanti.push('Categoria');
  mancanti.push(...campiObbligatoriVuoti(s.categoriaTop, s.attributes));
  return mancanti;
}

/** Il prodotto com'e' nel database, nei campi che servono al controllo. */
export type ProdottoAttuale = {
  status: string | null;
  name: string | null;
  description: string | null;
  price: number | string | null;
  category_id: string | null;
  images: string[] | null;
  attributes: Record<string, unknown> | null;
};

/**
 * Quando una modifica dell'assistente va controllata PRIMA di scriverla, e come.
 * La leggono il server (`cosaMancaDopoLaModifica`) e la scheda della proposta
 * nella chat (`avvisoSullaPubblicazione`): finche' erano due regole, la scheda
 * taceva sullo spostamento di un prodotto gia' in vendita e il server lo
 * fermava dopo Applica (16/10/2026).
 *
 *  - `vendita`: la modifica mette in vendita un prodotto che non lo era (da
 *    bozza o da esaurito) → tutti i controlli del modulo;
 *  - `categoria`: sposta un prodotto gia' in vendita in un'altra categoria di
 *    primo livello → solo i campi che la categoria nuova rende obbligatori. Una
 *    forchetta spostata fra gli alimentari diventerebbe un alimento in vetrina
 *    senza allergeni; il resto della scheda era gia' in vetrina e non e' questa
 *    modifica a cambiarlo. Con la stessa categoria di primo livello — una
 *    focaccia che passa da «Alimentari» ad «Alimentari / Pane» — i campi
 *    obbligatori sono gli stessi: fermarla buttava via, nel lavoro massivo,
 *    anche il nome e la descrizione migliorati di un alimento vecchio, salvato
 *    prima che gli allergeni fossero obbligatori (collaudo del 15/10);
 *  - `null`: nessun controllo — un prezzo, un tag su un prodotto gia' in
 *    vendita: e' lavoro normale.
 */
export function controlloDellaModifica(m: {
  statoPrima: unknown;
  statoDopo: unknown;
  /** Lo slug della categoria di PRIMO livello, prima e dopo la modifica. */
  categoriaPrima: string | null;
  categoriaDopo: string | null;
}): 'vendita' | 'categoria' | null {
  if (m.statoDopo !== 'available') return null;
  if (m.statoPrima !== 'available') return 'vendita';
  return m.categoriaDopo !== m.categoriaPrima ? 'categoria' : null;
}

/** Cosa manca per passare il controllo, con le parole del modulo. Vuoto = si puo'. */
function cosaMancaPerIlControllo(controllo: 'vendita' | 'categoria' | null, s: SchedaDaVendere): string[] {
  if (controllo === null) return [];
  return controllo === 'vendita' ? cosaMancaPerVendere(s) : campiObbligatoriVuoti(s.categoriaTop, s.attributes);
}

/** Il controllo da fare PRIMA di scrivere una modifica dell'assistente (vedi `controlloDellaModifica`). */
export function cosaMancaDopoLaModifica(opts: {
  prima: ProdottoAttuale;
  update: Record<string, unknown>;
  categories: CategoryRow[];
}): string[] {
  const { prima, update, categories } = opts;
  const albero = categories.map((c) => ({ id: c.id, slug: c.slug, parent_id: c.parent_id }));
  const valore = <K extends keyof ProdottoAttuale>(k: K) =>
    (k in update ? update[k] : prima[k]) as ProdottoAttuale[K];
  const categoryId = valore('category_id');
  const { topSlug } = getAttributesForCategory(albero, categoryId);
  const controllo = controlloDellaModifica({
    statoPrima: prima.status,
    statoDopo: valore('status'),
    categoriaPrima: getAttributesForCategory(albero, prima.category_id).topSlug,
    categoriaDopo: topSlug,
  });
  return cosaMancaPerIlControllo(controllo, {
    name: valore('name'),
    description: valore('description'),
    price: valore('price'),
    haCategoria: Boolean(categoryId),
    categoriaTop: topSlug,
    numeroFoto: Array.isArray(prima.images) ? prima.images.filter(Boolean).length : 0,
    attributes: valore('attributes'),
  });
}

/**
 * Il messaggio per il negoziante, quando qualcosa manca: lo stesso sulla scheda
 * della proposta (prima di Applica) e nel rifiuto del server (dopo). Vale per
 * un prodotto da mettere in vendita e per uno gia' in vendita spostato di
 * categoria: prima diceva «Per metterlo in vendita manca» anche a chi lo aveva
 * gia' in vendita. Corto apposta: la chat lo fa passare da `friendlyError`,
 * che sopra i 200 caratteri lo sostituisce con un messaggio generico e
 * l'elenco andrebbe perso.
 */
export function messaggioDaCompletare(mancanti: string[]): string {
  const motivo = motivoDaCompletare(mancanti);
  return `${motivo.charAt(0).toUpperCase()}${motivo.slice(1)}. Prima completa la scheda del prodotto.`;
}

/** Lo stesso perche', da mettere dentro un elenco (la rotta che applica in blocco). */
export function motivoDaCompletare(mancanti: string[]): string {
  return `con questa modifica non può stare in vendita, manca: ${mancanti.join(', ')}`;
}

/**
 * R36 — IL MOTIVO DEL DATABASE ARRIVA AL NEGOZIANTE.
 *
 * Il guardiano degli allergeni (migrazione 126) rifiuta la pubblicazione con
 * un messaggio scritto per il negoziante e il codice 23514. La rotta lo
 * trasformava in «Non sono riuscito a salvare. Riprova.»: il negoziante
 * riprovava, e riprovare dava lo stesso errore per sempre.
 *
 * Un 23514 e' una regola, non un guasto: riprovare non serve. Se il messaggio
 * e' scritto da noi (un RAISE nel database) passa com'e'; se e' quello tecnico
 * di un vincolo CHECK, al negoziante si dice cosa fare senza mostrargli il nome
 * del vincolo. Tutto il resto resta un guasto, e li' «Riprova» e' onesto.
 */
export function erroreDiSalvataggio(
  err: { code?: string | null; message?: string | null } | null | undefined,
): { tipo: 'regola' | 'guasto'; messaggio: string } {
  if (err?.code === '23514') {
    const testo = String(err.message ?? '').trim();
    const tecnico = !testo || /violates check constraint/i.test(testo) || /^[A-Z_]+:/.test(testo);
    return {
      tipo: 'regola',
      messaggio: tecnico
        ? 'Questa modifica non rispetta le regole del catalogo: un valore è troppo lungo o non valido. Apri la scheda del prodotto e controllala.'
        : testo.slice(0, 300),
    };
  }
  return { tipo: 'guasto', messaggio: 'Non sono riuscito a salvare. Riprova.' };
}

/* ------------------------------------------------------------------------- */
/*  La bozza dalle foto, nella chat Assistenza                                */
/* ------------------------------------------------------------------------- */

export type DichiarazioneDaFoto = { chiave: string; etichetta: string; valore: string };

/**
 * Il valore come lo legge una persona. Le caselle arrivano dal modello come
 * testo, «true» e «false»: nella scheda si leggeva «Senza glutine: false».
 */
/**
 * Vero se il valore dice qualcosa al cliente. Una casella non spuntata
 * («Senza glutine: false») non e' una dichiarazione: non si mostra.
 */
function diceQualcosa(v: unknown): boolean {
  if (v === false) return false;
  const t = String(v ?? '').trim();
  return t !== '' && !/^false$/i.test(t);
}

export function valoreLeggibile(v: unknown): string {
  if (typeof v === 'string' && /^(true|false)$/i.test(v.trim())) return /^true$/i.test(v.trim()) ? 'Sì' : 'No';
  return formatAttributeValue(typeof v === 'string' ? v.trim() : v);
}

/**
 * R36/R41 — La lettura dell'etichetta in foto e' l'unica strada da cui l'AI
 * porta allergeni e ingredienti in una scheda. Anche li' il negoziante li deve
 * VEDERE: questo dice quali dichiarazioni il modello ha letto e quali campi
 * obbligatori della categoria restano vuoti.
 */
export function dichiarazioniDellaBozza(draft: {
  category_slug?: string | null;
  attributes?: Record<string, unknown> | null;
}): { lette: DichiarazioneDaFoto[]; senzaCampo: string[]; obbligatoriVuoti: string[] } {
  const { conCampo, senzaCampo } = perCategoria(tutteLeDichiarazioniLette(draft.attributes), draft.category_slug);
  // Le chiavi dei campi presenti si leggono come quelle delle dichiarazioni
  // (`chiaveCampo`), e come le legge la porta che crea la bozza: «Allergeni»
  // con la maiuscola contava come dichiarazione letta ma non come campo pieno.
  const presenti: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft.attributes ?? {})) presenti[chiaveCampo(k)] = v;
  return { lette: conCampo, senzaCampo, obbligatoriVuoti: campiObbligatoriVuoti(draft.category_slug, presenti) };
}

/** Tutte le dichiarazioni che il modello ha letto, qualunque sia la categoria. */
function tutteLeDichiarazioniLette(attributes: Record<string, unknown> | null | undefined): DichiarazioneDaFoto[] {
  const { scartati } = separaCampiDichiarativi({ attributes: attributes ?? {} });
  return scartati
    .filter(
      (s): s is DichiarazioneScartata & { valore: string } =>
        s.azione === 'scrivi' && !!s.valore && diceQualcosa(s.valore),
    )
    .map((s) => ({ chiave: s.chiave, etichetta: s.etichetta, valore: valoreLeggibile(s.valore) }));
}

/**
 * 16/10/2026 — Una dichiarazione letta per un campo che la categoria NON ha
 * (un'«Origine» su un vaso della categoria Casa) non entra nella bozza: la
 * porta la scarta anche con la spunta. Il riquadro la chiedeva da confermare
 * e poi diceva «le scrivi tu nella scheda», ma la scheda di Casa quel campo non
 * lo ha. Qui si separano: le prime si confermano, le altre si dicono e basta.
 */
function perCategoria(
  lette: DichiarazioneDaFoto[],
  categoriaTop: string | null | undefined,
): { conCampo: DichiarazioneDaFoto[]; senzaCampo: string[] } {
  const campi = categoriaTop ? CATEGORY_ATTRIBUTES[categoriaTop] ?? [] : [];
  const conCampo = lette.filter((l) => campi.some((f) => f.key === l.chiave));
  const senzaCampo = lette.filter((l) => !conCampo.includes(l)).map((l) => l.etichetta);
  return { conCampo, senzaCampo };
}

/** La frase delle dichiarazioni lette che la categoria della bozza non ha (null = nessuna). */
function fraseSenzaCampo(
  senzaCampo: string[],
  categoriaTop: string | null | undefined,
  quando: 'prima' | 'dopo',
  /** Il titolo dice gia' «NON entrano»: qui resta solo il perche'. */
  giaNelTitolo: boolean,
): string | null {
  if (senzaCampo.length === 0) return null;
  const elenco = senzaCampo.join(', ');
  const perche = categoriaTop
    ? 'la categoria della bozza non ha questi campi'
    : 'la bozza non ha una categoria con questi campi';
  if (giaNelTitolo) return `${perche.charAt(0).toUpperCase()}${perche.slice(1)}: ${elenco}.`;
  const verbo = quando === 'prima' ? 'non entrano' : 'non sono entrate';
  return `Lette dalle foto ma ${verbo} nella bozza, perché ${perche}: ${elenco}.`;
}

/**
 * Gli altri attributi della bozza (marca, peso, ...), per mostrarli: SOLO
 * quelli che entrano, con la regola della porta (`attributoCheEntra`) e la
 * categoria della bozza. Prima si mostrava tutto quello che il modello aveva
 * scritto: «Tipo di confezione: Vaschetta» e «Colore: Verde» su un barattolo di
 * olive, mentre nella bozza entrava solo il peso; e «Condizione» con la
 * maiuscola compariva fra le caratteristiche mentre la porta la salvava come
 * stato del prodotto (16/10/2026). Le chiavi si leggono come le legge la porta
 * (`chiaveCampo`: maiuscole, spazi e trattini non contano).
 */
export function attributiNonDichiarativi(
  attributes: Record<string, unknown> | null | undefined,
  categoriaTop: string | null | undefined,
): { etichetta: string; valore: string }[] {
  const campi = categoriaTop ? CATEGORY_ATTRIBUTES[categoriaTop] ?? [] : [];
  // Due chiavi che puntano allo stesso campo («Peso» e «peso»): vince
  // l'ultima, come nella porta.
  const entrano = new Map<string, string>();
  for (const [k, v] of Object.entries(attributes ?? {})) {
    const chiave = chiaveCampo(k);
    if (chiave === 'condizione' || eCampoDichiarativo(chiave)) continue;
    const entra = attributoCheEntra(campi, k, v);
    if (!entra || !diceQualcosa(entra.valore)) continue;
    entrano.delete(entra.chiave);
    entrano.set(entra.chiave, entra.valore);
  }
  return [...entrano].map(([chiave, valore]) => ({
    etichetta: campi.find((f) => f.key === chiave)?.label ?? findLabelForKey(chiave),
    valore: valoreLeggibile(valore),
  }));
}

/**
 * Le caratteristiche da mostrare sulla scheda della bozza: prima della
 * creazione quelle che entreranno, dopo quelle che sono ENTRATE (la bozza
 * salvata), come fa gia' il riquadro delle dichiarazioni.
 */
export function caratteristicheDellaBozza(
  draft: { category_slug?: string | null; attributes?: Record<string, unknown> | null },
  stato: { creata: false } | { creata: true; salvata: BozzaSalvata },
): { etichetta: string; valore: string }[] {
  if (!stato.creata) return attributiNonDichiarativi(draft.attributes, draft.category_slug);
  const campi = stato.salvata.categorySlug ? CATEGORY_ATTRIBUTES[stato.salvata.categorySlug] ?? [] : [];
  const salvati = stato.salvata.attributes ?? {};
  return campi
    .filter((f) => !eCampoDichiarativo(f.key) && diceQualcosa(salvati[f.key]))
    .map((f) => ({ etichetta: f.label, valore: valoreLeggibile(salvati[f.key]) }));
}

/** Il riquadro delle dichiarazioni sotto la bozza dalle foto. */
export type RiquadroDichiarazioni = {
  titolo: string;
  righe: { etichetta: string; valore: string }[];
  /** Cosa resta da scrivere nella scheda prima di pubblicare (null = niente). */
  daScrivere: string | null;
  /** Vero finche' la bozza non e' creata e c'e' qualcosa da confermare. */
  chiediSpunta: boolean;
};

/**
 * La bozza come l'ha salvata il server: lo snapshot che torna da
 * `/api/ai/catalog-create` (categoria di primo livello e attributi veri).
 */
export type BozzaSalvata = {
  categorySlug: string | null;
  attributes: Record<string, unknown> | null;
};

/** La frase di cosa resta da scrivere nella scheda (null = niente). */
function fraseDaScrivere(mancano: string[]): string | null {
  return mancano.length > 0 ? `Manca e lo scrivi tu nella scheda prima di pubblicare: ${mancano.join(', ')}.` : null;
}

/**
 * R36 — Cosa dice il riquadro «Da controllare tu», prima e dopo la creazione.
 *
 * Prima: le dichiarazioni lette dalle foto e la spunta per confermarle. Dopo,
 * il riquadro deve dire il vero su cosa e' entrato: senza spunta la bozza nasce
 * senza, e una scheda che continua a mostrare «Allergeni: Glutine» fa credere
 * il contrario (collaudo del 15/10).
 *
 * 16/10/2026 — Dopo la creazione il riquadro si legge dalla bozza SALVATA, non
 * da quella proposta. Prima si ricostruiva cosa era entrato dalla proposta e
 * dalla spunta: se il server scartava un campo (una chiave scritta «Allergeni»
 * con la maiuscola), il riquadro titolava «Entrate nella bozza» con gli
 * allergeni elencati e, sotto, «Manca: Allergeni». Adesso «entrata» e' solo una
 * dichiarazione che c'e' nella bozza salvata, col valore che ha li'.
 */
export function riquadroDichiarazioni(
  draft: { category_slug?: string | null; attributes?: Record<string, string> | null },
  stato: { creata: false; confermate: boolean } | { creata: true; confermate: boolean; salvata: BozzaSalvata },
): RiquadroDichiarazioni | null {
  const DA_CONTROLLARE = 'Da controllare tu: è la tua dichiarazione ai clienti';
  /** Le frasi sotto le righe, nell'ordine; null = nessuna. */
  const unite = (...frasi: (string | null)[]) => frasi.filter((f): f is string => f !== null).join(' ') || null;

  if (!stato.creata) {
    const { lette, senzaCampo, obbligatoriVuoti } = dichiarazioniDellaBozza(draft);
    if (lette.length === 0 && obbligatoriVuoti.length === 0 && senzaCampo.length === 0) return null;
    // Solo dichiarazioni che la categoria non ha: niente da confermare.
    const soloFuori = lette.length === 0 && obbligatoriVuoti.length === 0;
    return {
      titolo: soloFuori ? 'Lette dalle foto ma NON entrano nella bozza' : DA_CONTROLLARE,
      righe: lette.map(({ etichetta, valore }) => ({ etichetta, valore })),
      daScrivere: unite(
        fraseSenzaCampo(senzaCampo, draft.category_slug, 'prima', soloFuori),
        fraseDaScrivere(obbligatoriVuoti),
      ),
      chiediSpunta: lette.length > 0,
    };
  }

  // 16/10/2026 — Dopo la creazione la categoria che conta e' quella della bozza
  // SALVATA: «le scrivi tu nella scheda» solo per i campi che quella scheda ha.
  const categoria = stato.salvata.categorySlug;
  const { conCampo: lette, senzaCampo } = perCategoria(tutteLeDichiarazioniLette(draft.attributes), categoria);
  const righeLette = lette.map(({ etichetta, valore }) => ({ etichetta, valore }));
  const salvati = stato.salvata.attributes ?? {};
  const mancano = campiObbligatoriVuoti(categoria, salvati);
  if (lette.length === 0 && mancano.length === 0 && senzaCampo.length === 0) return null;
  const entrate = lette.filter((l) => diceQualcosa(salvati[l.chiave]));

  if (entrate.length === 0) {
    const soloFuori = lette.length === 0 && mancano.length === 0;
    return {
      titolo:
        lette.length > 0
          ? 'Lette dalle foto ma NON entrate nella bozza: le scrivi tu nella scheda'
          : soloFuori
            ? 'Lette dalle foto ma NON entrate nella bozza'
            : DA_CONTROLLARE,
      righe: righeLette,
      daScrivere: unite(fraseSenzaCampo(senzaCampo, categoria, 'dopo', soloFuori), fraseDaScrivere(mancano)),
      chiediSpunta: false,
    };
  }

  // Entrate, magari non tutte: quelle rimaste fuori si dicono, una volta sola
  // (se sono anche obbligatorie le dice gia' la frase di cosa manca).
  const fuori = lette
    .filter((l) => !entrate.includes(l) && !mancano.includes(l.etichetta))
    .map((l) => l.etichetta);
  return {
    titolo: stato.confermate ? 'Entrate nella bozza: le hai confermate tu' : 'Entrate nella bozza',
    righe: entrate.map((l) => ({ etichetta: l.etichetta, valore: valoreLeggibile(salvati[l.chiave]) })),
    daScrivere: unite(
      fuori.length > 0 ? `Non sono entrate nella bozza: ${fuori.join(', ')}.` : null,
      fraseSenzaCampo(senzaCampo, categoria, 'dopo', false),
      fraseDaScrivere(mancano),
    ),
    chiediSpunta: false,
  };
}

/**
 * La bozza che parte davvero verso il database, dalla chat Assistenza o da
 * «Crea più prodotti dalle foto». Se il negoziante NON ha spuntato «le ho
 * controllate», le dichiarazioni lette dal modello restano fuori: la bozza
 * nasce senza, e i campi obbligatori vuoti impediranno di metterla in vendita
 * finche' non li scrive lui.
 *
 * La spunta viaggia anche come `dichiarazioni_confermate`: il server
 * (`buildDraftProductInsert`) senza quella le toglie comunque. Qui si tolgono
 * prima per non spedire quello che non deve entrare; la' perche' la regola
 * valga anche per chi un giorno chiamera' la rotta senza passare di qui.
 */
export function bozzaDaCreare<T extends { attributes?: Record<string, string> | null }>(
  draft: T,
  dichiarazioniConfermate: boolean,
): T & { dichiarazioni_confermate: boolean } {
  if (dichiarazioniConfermate) return { ...draft, dichiarazioni_confermate: true };
  const { patch } = separaCampiDichiarativi({ attributes: draft.attributes ?? {} });
  return {
    ...draft,
    attributes: (patch as { attributes?: Record<string, string> }).attributes ?? {},
    dichiarazioni_confermate: false,
  };
}

/** La scheda come la vede la chat (lo snapshot che torna dal server). */
export type SchedaDellaChat = {
  name: string;
  description: string;
  price: number | null;
  categorySlug: string | null;
  attributes: Record<string, unknown>;
  image: string | null;
};

/** Lo snapshot che ha in mano la chat, nei campi del controllo. */
function schedaDaVendere(prodotto: SchedaDellaChat): SchedaDaVendere {
  return {
    name: prodotto.name,
    description: prodotto.description,
    price: prodotto.price,
    haCategoria: Boolean(prodotto.categorySlug),
    categoriaTop: prodotto.categorySlug,
    numeroFoto: prodotto.image ? 1 : 0,
    attributes: prodotto.attributes,
  };
}

/** Cosa manca per vendere, letto dallo snapshot che ha in mano la chat. */
export function cosaMancaNellaScheda(prodotto: SchedaDellaChat): string[] {
  return cosaMancaPerVendere(schedaDaVendere(prodotto));
}

/**
 * La scheda come sara' DOPO la proposta dell'assistente, letta dalla chat.
 *
 * La scheda di una proposta «Stato → In vendita» guardava il prodotto com'e'
 * adesso e ignorava il resto della stessa proposta: «Descrizione aggiornata ·
 * Stato → In vendita» stava sopra «Non si può ancora mettere in vendita: manca
 * la descrizione», e premendo Applica il server accettava (collaudo del 15/10).
 * Qui la scheda si legge come la leggera' il server: con i campi della
 * proposta sopra quelli attuali, senza le dichiarazioni (che l'assistente non
 * scrive) e senza un prezzo fuori banda (che il server scarta).
 */
function schedaDopoLaProposta(prodotto: SchedaDellaChat, proposta: AiProductPatch): SchedaDellaChat {
  const { patch } = separaCampiDichiarativi(proposta);
  const attributes: Record<string, unknown> = { ...prodotto.attributes };
  // 16/10/2026 — La proposta arriva dal modello cosi' com'e': lo schema dello
  // strumento dice «elenco di chiavi», ma nessuno lo garantisce. Un
  // `attributes_remove` scritto come oggetto faceva cadere la chat intera
  // («object is not iterable») mentre si disegnava la scheda. Qui un campo
  // senza la forma giusta si ignora, come fa il server (`resolveAiPatch`).
  const daScrivere =
    patch.attributes && typeof patch.attributes === 'object' ? (patch.attributes as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(daScrivere)) {
    if (typeof v === 'string' && v.trim()) attributes[AI_ATTR_TO_FIELD[k] ?? k] = v;
  }
  const daTogliere: unknown[] = Array.isArray(patch.attributes_remove) ? patch.attributes_remove : [];
  for (const voce of daTogliere) {
    const k = voceComeTesto(voce);
    if (k) delete attributes[AI_ATTR_TO_FIELD[k] ?? k];
  }
  const prezzoValido =
    typeof patch.price === 'number' && patch.price > 0 && !prezzoAiFuoriBanda(patch.price, prodotto.price);
  return {
    ...prodotto,
    name: typeof patch.name === 'string' && patch.name.trim() ? patch.name : prodotto.name,
    description:
      typeof patch.description === 'string' && patch.description.trim() ? patch.description : prodotto.description,
    price: prezzoValido ? patch.price! : prodotto.price,
    categorySlug: patch.category_slug || prodotto.categorySlug,
    attributes,
  };
}

/**
 * R36 — Le dichiarazioni con cui il prodotto andrebbe in vetrina (allergeni,
 * ingredienti, caselle «senza…»), per mostrarle sulla scheda di una proposta
 * «Stato → In vendita»: il negoziante le rilegge prima di premere Applica.
 */
export function dichiarazioniInVetrina(prodotto: SchedaDellaChat): { etichetta: string; valore: string }[] {
  const campi = prodotto.categorySlug ? CATEGORY_ATTRIBUTES[prodotto.categorySlug] ?? [] : [];
  return campi
    .filter((f) => eCampoDichiarativo(f.key) && diceQualcosa(prodotto.attributes[f.key]))
    .map((f) => ({ etichetta: f.label, valore: valoreLeggibile(prodotto.attributes[f.key]) }));
}

/**
 * R36 — Cosa mostra la scheda di una proposta prima di Applica, con la regola
 * del server (`controlloDellaModifica`): `null` se il server non controllera'
 * niente. Altrimenti: cosa manca (letto come lo leggera' il server) e le
 * dichiarazioni con cui il prodotto stara' in vetrina, da rileggere.
 *
 * 16/10/2026 — Prima rispondeva solo a una proposta che mette il prodotto in
 * vendita. «Spostala negli alimentari», per una focaccia in vendita finita per
 * errore in Casa, non mostrava niente; premuto Applica, il server la fermava
 * perche' mancavano allergeni e ingredienti.
 */
export function avvisoSullaPubblicazione(
  prodotto: SchedaDellaChat & { status: string },
  proposta: AiProductPatch,
): { mancanti: string[]; dichiarazioni: { etichetta: string; valore: string }[] } | null {
  const dopo = schedaDopoLaProposta(prodotto, proposta);
  const controllo = controlloDellaModifica({
    statoPrima: prodotto.status,
    // Lo stato si scrive solo se e' uno di quelli del venditore, come sul server.
    statoDopo: (SELLER_STATUSES as readonly unknown[]).includes(proposta.status) ? proposta.status : prodotto.status,
    categoriaPrima: prodotto.categorySlug,
    categoriaDopo: dopo.categorySlug,
  });
  if (controllo === null) return null;
  return {
    mancanti: cosaMancaPerIlControllo(controllo, schedaDaVendere(dopo)),
    dichiarazioni: dichiarazioniInVetrina(dopo),
  };
}

/**
 * R36 — Dopo «Crea più prodotti dalle foto»: quali bozze non si possono ancora
 * pubblicare perche' mancano le dichiarazioni obbligatorie (per un alimento
 * Allergeni e Ingredienti). `null` se nessuna. Il negoziante lo legge subito,
 * invece di scoprirlo quando prova a pubblicare.
 */
export function avvisoDopoLeBozze(prodotti: SchedaDellaChat[]): string | null {
  const daCompletare = prodotti
    .map((p) => ({ nome: p.name, manca: campiObbligatoriVuoti(p.categorySlug, p.attributes) }))
    .filter((p) => p.manca.length > 0);
  if (daCompletare.length === 0) return null;
  const n = daCompletare.length;
  const righe = daCompletare.slice(0, 3).map((p) => `«${p.nome}» (${p.manca.join(', ')})`);
  const altre = n - righe.length;
  return (
    `${n === 1 ? 'Una bozza va completata' : `${n} bozze vanno completate`} prima di pubblicarle: ` +
    `${righe.join(', ')}${altre > 0 ? ` e altre ${altre}` : ''}. Aprile e scrivi tu questi campi nella scheda.`
  );
}

/**
 * Cosa dice la chat dopo aver creato la bozza. Invita a scrivere «pubblica»
 * SOLO se la scheda ha gia' tutto: altrimenti dice cosa manca e dove si
 * compila. Il prodotto arriva com'e' tornato dal server.
 */
export function messaggioDopoLaBozza(prodotto: SchedaDellaChat): string {
  const mancanti = cosaMancaNellaScheda(prodotto);
  if (mancanti.length === 0) {
    return 'Bozza creata: è nascosta ai clienti finché non la pubblichi. Vuoi pubblicarla ("pubblica") o cambiare qualcosa?';
  }
  return `Bozza creata: è nascosta ai clienti. Prima di pubblicarla va completato: ${mancanti.join(', ')}. Aprila con «Apri» qui sopra e compila tu questi campi.`;
}

/** Come si chiama uno stato del prodotto nella chat. */
export const ETICHETTE_STATO: Record<string, string> = {
  available: 'In vendita',
  draft: 'Bozza',
  sold: 'Esaurito',
};

/**
 * La scheda di una proposta nella chat Assistenza: cosa cambierebbe, prima→dopo
 * dove si puo'. Stava dentro il componente; e' qui perche' due difetti dello
 * stesso giro (16/10/2026) erano nel modo di leggere la proposta.
 *
 *  1. Con un elenco dentro l'elenco (`attributes_remove: [["allergeni"]]`) la
 *     riga delle dichiarazioni passava l'elenco a `findLabelForKey`, che su un
 *     elenco cade: la chat spariva intera. La rotta adesso manda la proposta
 *     gia' nella forma giusta (`propostaPerLaChat`); qui, in piu', ogni voce si
 *     legge come testo e un campo senza la forma giusta si salta, come fa il
 *     server.
 *  2. «Origine → «Italia»: lo scrivi tu nella scheda del prodotto» anche su un
 *     vaso della categoria Casa, la cui scheda il campo Origine non lo ha.
 *     Adesso la riga guarda la categoria con cui il prodotto restera' dopo la
 *     proposta.
 */
export function righeDellaProposta(
  patch: AiProductPatch,
  prodotto: { price: number | null; categorySlug: string | null },
): string[] {
  const out: string[] = [];
  const eur = (n: number) => formatPrice(n);
  const testo = (v: unknown): v is string => typeof v === 'string';
  if (testo(patch.name)) out.push(`Nome → "${patch.name}"`);
  if (testo(patch.description)) out.push('Descrizione aggiornata');
  if (typeof patch.price === 'number') {
    out.push(`Prezzo: ${prodotto.price != null ? eur(prodotto.price) : '—'} → ${eur(patch.price)}`);
  }
  if ('compare_at_price' in patch) {
    if (patch.compare_at_price == null) out.push('Rimuovi prezzo pieno');
    else if (typeof patch.compare_at_price === 'number') out.push(`Prezzo pieno → ${eur(patch.compare_at_price)}`);
  }
  if (testo(patch.unit) && patch.unit) out.push(`Unità → ${patch.unit}`);
  if ('condition' in patch && (patch.condition == null || testo(patch.condition))) {
    out.push(`Condizione → ${patch.condition ?? 'non specificata'}`);
  }
  if (patch.unlimited_stock === true) out.push('Disponibilità → illimitata');
  else if (typeof patch.stock === 'number') out.push(`Disponibilità → ${patch.stock} pz`);
  if (testo(patch.category_slug) && patch.category_slug) {
    const sotto = testo(patch.subcategory_name) && patch.subcategory_name ? ` / ${patch.subcategory_name}` : '';
    out.push(`Categoria → ${patch.category_slug}${sotto}`);
  }
  if (Array.isArray(patch.tags)) out.push(`Tag → ${patch.tags.map(voceComeTesto).join(', ') || '(nessuno)'}`);

  // R41 — Allergeni, ingredienti e le altre dichiarazioni di un alimento non
  // si cambiano da qui: la card lo dice invece di prometterlo, e rimanda alla
  // scheda solo se la scheda quel campo ce l'ha.
  const categoria = (testo(patch.category_slug) && patch.category_slug) || prodotto.categorySlug;
  const campi = categoria ? CATEGORY_ATTRIBUTES[categoria] ?? [] : [];
  const dichiarazione = (chiaveAi: string) => {
    const chiave = chiaveCampo(chiaveAi);
    const campo = campi.find((f) => f.key === chiave);
    return { etichetta: campo?.label ?? findLabelForKey(chiave), nellaScheda: campo !== undefined };
  };
  const attributi =
    patch.attributes && typeof patch.attributes === 'object' && !Array.isArray(patch.attributes)
      ? (patch.attributes as Record<string, unknown>)
      : {};
  for (const [k, grezzo] of Object.entries(attributi)) {
    const v = typeof grezzo === 'string' ? grezzo.trim() : '';
    if (!v) continue;
    if (!eCampoDichiarativo(k)) {
      out.push(`${k} → ${v}`);
      continue;
    }
    const d = dichiarazione(k);
    out.push(
      d.nellaScheda
        ? `${d.etichetta} → «${v}»: NON si applica, lo scrivi tu nella scheda del prodotto`
        : `${d.etichetta} → «${v}»: NON si applica, e la scheda di questo prodotto non ha il campo ${d.etichetta}`,
    );
  }
  const daTogliere: unknown[] = Array.isArray(patch.attributes_remove) ? patch.attributes_remove : [];
  for (const voce of daTogliere) {
    // Come la legge il server (`String`), ma una voce illeggibile non fa
    // cadere la chat: non nomina niente, e si salta.
    const k = voceComeTesto(voce);
    if (!k) continue;
    if (!eCampoDichiarativo(k)) {
      out.push(`Rimuovi ${k}`);
      continue;
    }
    const d = dichiarazione(k);
    out.push(
      d.nellaScheda
        ? `Rimuovi ${d.etichetta}: NON si applica, lo decidi tu nella scheda del prodotto`
        : `Rimuovi ${d.etichetta}: NON si applica`,
    );
  }
  if (testo(patch.status) && patch.status) out.push(`Stato → ${ETICHETTE_STATO[patch.status] ?? patch.status}`);
  return out;
}

// lib/products/prontoPerLaVendita.ts
import {
  AI_ATTR_TO_FIELD,
  CATEGORY_ATTRIBUTES,
  findLabelForKey,
  getAttributesForCategory,
} from '@/lib/category-attributes';
import {
  eCampoDichiarativo,
  separaCampiDichiarativi,
  type CategoryRow,
  type DichiarazioneScartata,
} from '@/lib/products/aiPatch';

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
    mancanti.push(`Descrizione (almeno ${MIN_DESCRIZIONE_PER_VENDERE} caratteri)`);
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
 * Il controllo da fare PRIMA di scrivere una modifica dell'assistente.
 *
 * Scatta quando la modifica porta il prodotto in vendita (da bozza o da
 * esaurito), e quando sposta di categoria un prodotto che e' gia' in vendita:
 * una forchetta spostata fra gli alimentari diventerebbe un alimento in vetrina
 * senza allergeni. Negli altri casi — un prezzo, un tag su un prodotto gia' in
 * vendita — non blocca niente: e' lavoro normale.
 */
export function cosaMancaDopoLaModifica(opts: {
  prima: ProdottoAttuale;
  update: Record<string, unknown>;
  categories: CategoryRow[];
}): string[] {
  const { prima, update, categories } = opts;
  const statoFinale = 'status' in update ? update.status : prima.status;
  if (statoFinale !== 'available') return [];

  const diventaInVendita = update.status === 'available' && prima.status !== 'available';
  const cambiaCategoria = 'category_id' in update && update.category_id !== prima.category_id;
  if (!diventaInVendita && !cambiaCategoria) return [];

  const categoryId = (cambiaCategoria ? update.category_id : prima.category_id) as string | null;
  const { topSlug } = getAttributesForCategory(
    categories.map((c) => ({ id: c.id, slug: c.slug, parent_id: c.parent_id })),
    categoryId,
  );
  const attributes = ('attributes' in update ? update.attributes : prima.attributes) as
    | Record<string, unknown>
    | null;

  // Sullo spostamento di categoria di un prodotto gia' in vendita si guardano
  // solo i campi che la categoria nuova rende obbligatori: il resto della
  // scheda era gia' in vetrina e non e' questa modifica a cambiarlo.
  if (!diventaInVendita) return campiObbligatoriVuoti(topSlug, attributes);

  const valore = <K extends keyof ProdottoAttuale>(k: K) =>
    (k in update ? update[k] : prima[k]) as ProdottoAttuale[K];
  return cosaMancaPerVendere({
    name: valore('name'),
    description: valore('description'),
    price: valore('price'),
    haCategoria: Boolean(categoryId),
    categoriaTop: topSlug,
    numeroFoto: Array.isArray(prima.images) ? prima.images.filter(Boolean).length : 0,
    attributes,
  });
}

/** Il messaggio per il negoziante, quando qualcosa manca. */
export function messaggioDaCompletare(mancanti: string[]): string {
  return `Prima di metterlo in vendita va completato: ${mancanti.join(', ')}. Apri la scheda del prodotto e compilalo tu.`;
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
        ? 'Questa modifica non rispetta le regole del catalogo (un valore troppo lungo o non valido). Apri la scheda del prodotto e controllala.'
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
 * R36/R41 — La lettura dell'etichetta in foto e' l'unica strada da cui l'AI
 * porta allergeni e ingredienti in una scheda. Anche li' il negoziante li deve
 * VEDERE: questo dice quali dichiarazioni il modello ha letto e quali campi
 * obbligatori della categoria restano vuoti.
 */
export function dichiarazioniDellaBozza(draft: {
  category_slug?: string | null;
  attributes?: Record<string, unknown> | null;
}): { lette: DichiarazioneDaFoto[]; obbligatoriVuoti: string[] } {
  const { scartati } = separaCampiDichiarativi({ attributes: draft.attributes ?? {} });
  const lette = scartati
    .filter((s): s is DichiarazioneScartata & { valore: string } => s.azione === 'scrivi' && !!s.valore)
    .map((s) => ({ chiave: s.chiave, etichetta: s.etichetta, valore: s.valore }));
  const presenti: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft.attributes ?? {})) presenti[AI_ATTR_TO_FIELD[k] ?? k] = v;
  return { lette, obbligatoriVuoti: campiObbligatoriVuoti(draft.category_slug, presenti) };
}

/** Gli altri attributi letti dalle foto (marca, peso, ...), per mostrarli. */
export function attributiNonDichiarativi(
  attributes: Record<string, unknown> | null | undefined,
): { etichetta: string; valore: string }[] {
  return Object.entries(attributes ?? {})
    .filter(([k, v]) => !eCampoDichiarativo(k) && k !== 'condizione' && String(v ?? '').trim())
    .map(([k, v]) => ({ etichetta: findLabelForKey(k), valore: String(v).trim() }));
}

/**
 * La bozza che parte davvero verso il database. Se il negoziante NON ha
 * spuntato «le ho controllate», le dichiarazioni lette dal modello restano
 * fuori: la bozza nasce senza, e i campi obbligatori vuoti impediranno di
 * metterla in vendita finche' non li scrive lui.
 */
export function bozzaDaCreare<T extends { attributes?: Record<string, string> | null }>(
  draft: T,
  dichiarazioniConfermate: boolean,
): T {
  if (dichiarazioniConfermate) return draft;
  const { patch } = separaCampiDichiarativi({ attributes: draft.attributes ?? {} });
  return { ...draft, attributes: (patch as { attributes?: Record<string, string> }).attributes ?? {} };
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

/** Cosa manca per vendere, letto dallo snapshot che ha in mano la chat. */
export function cosaMancaNellaScheda(prodotto: SchedaDellaChat): string[] {
  return cosaMancaPerVendere({
    name: prodotto.name,
    description: prodotto.description,
    price: prodotto.price,
    haCategoria: Boolean(prodotto.categorySlug),
    categoriaTop: prodotto.categorySlug,
    numeroFoto: prodotto.image ? 1 : 0,
    attributes: prodotto.attributes,
  });
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

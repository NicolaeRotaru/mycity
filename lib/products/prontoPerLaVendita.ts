// lib/products/prontoPerLaVendita.ts
import {
  AI_ATTR_TO_FIELD,
  CATEGORY_ATTRIBUTES,
  findLabelForKey,
  formatAttributeValue,
  getAttributesForCategory,
} from '@/lib/category-attributes';
import {
  eCampoDichiarativo,
  prezzoAiFuoriBanda,
  separaCampiDichiarativi,
  type AiProductPatch,
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

  const albero = categories.map((c) => ({ id: c.id, slug: c.slug, parent_id: c.parent_id }));
  const categoryId = (cambiaCategoria ? update.category_id : prima.category_id) as string | null;
  const { topSlug } = getAttributesForCategory(albero, categoryId);
  const attributes = ('attributes' in update ? update.attributes : prima.attributes) as
    | Record<string, unknown>
    | null;

  // Sullo spostamento di categoria di un prodotto gia' in vendita si guardano
  // solo i campi che la categoria nuova rende obbligatori: il resto della
  // scheda era gia' in vetrina e non e' questa modifica a cambiarlo.
  //
  // E se la categoria di primo livello resta la stessa — una focaccia che passa
  // da «Alimentari» ad «Alimentari / Pane» — i campi obbligatori sono gli
  // stessi di prima: la modifica non rende la scheda ne' migliore ne' peggiore.
  // Fermarla buttava via, nel lavoro massivo, anche il nome e la descrizione
  // migliorati di un alimento vecchio, salvato prima che gli allergeni fossero
  // obbligatori (collaudo del 15/10).
  if (!diventaInVendita) {
    if (topSlug === getAttributesForCategory(albero, prima.category_id).topSlug) return [];
    return campiObbligatoriVuoti(topSlug, attributes);
  }

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

/**
 * Il messaggio per il negoziante, quando qualcosa manca. Corto apposta: la
 * chat lo fa passare da `friendlyError`, che sopra i 200 caratteri lo
 * sostituisce con un messaggio generico e l'elenco andrebbe perso.
 */
export function messaggioDaCompletare(mancanti: string[]): string {
  return `Per metterlo in vendita manca: ${mancanti.join(', ')}. Compilalo nella scheda del prodotto.`;
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
}): { lette: DichiarazioneDaFoto[]; obbligatoriVuoti: string[] } {
  const { scartati } = separaCampiDichiarativi({ attributes: draft.attributes ?? {} });
  const lette = scartati
    .filter(
      (s): s is DichiarazioneScartata & { valore: string } =>
        s.azione === 'scrivi' && !!s.valore && diceQualcosa(s.valore),
    )
    .map((s) => ({ chiave: s.chiave, etichetta: s.etichetta, valore: valoreLeggibile(s.valore) }));
  const presenti: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft.attributes ?? {})) presenti[AI_ATTR_TO_FIELD[k] ?? k] = v;
  return { lette, obbligatoriVuoti: campiObbligatoriVuoti(draft.category_slug, presenti) };
}

/** Gli altri attributi letti dalle foto (marca, peso, ...), per mostrarli. */
export function attributiNonDichiarativi(
  attributes: Record<string, unknown> | null | undefined,
): { etichetta: string; valore: string }[] {
  return Object.entries(attributes ?? {})
    .filter(([k, v]) => !eCampoDichiarativo(k) && k !== 'condizione' && diceQualcosa(v))
    .map(([k, v]) => ({ etichetta: findLabelForKey(k), valore: valoreLeggibile(v) }));
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
 * R36 — Cosa dice il riquadro «Da controllare tu», prima e dopo la creazione.
 *
 * Prima: le dichiarazioni lette dalle foto e la spunta per confermarle. Dopo,
 * il riquadro deve dire il vero su cosa e' entrato: senza spunta la bozza nasce
 * senza, e una scheda che continua a mostrare «Allergeni: Glutine» fa credere
 * il contrario (collaudo del 15/10).
 */
export function riquadroDichiarazioni(
  draft: { category_slug?: string | null; attributes?: Record<string, string> | null },
  stato: { creata: boolean; confermate: boolean },
): RiquadroDichiarazioni | null {
  const { lette, obbligatoriVuoti } = dichiarazioniDellaBozza(draft);
  if (lette.length === 0 && obbligatoriVuoti.length === 0) return null;
  const righe = lette.map(({ etichetta, valore }) => ({ etichetta, valore }));
  const entrate = !stato.creata || stato.confermate;
  // Dopo una creazione senza spunta, manca anche quello che il modello aveva letto.
  const mancano = entrate
    ? obbligatoriVuoti
    : dichiarazioniDellaBozza(bozzaDaCreare(draft, false)).obbligatoriVuoti;
  return {
    titolo: !stato.creata
      ? 'Da controllare tu: è la tua dichiarazione ai clienti'
      : stato.confermate
        ? 'Entrate nella bozza: le hai confermate tu'
        : 'Lette dalle foto ma NON entrate nella bozza: le scrivi tu nella scheda',
    righe,
    daScrivere:
      mancano.length > 0 ? `Manca e lo scrivi tu nella scheda prima di pubblicare: ${mancano.join(', ')}.` : null,
    chiediSpunta: !stato.creata && lette.length > 0,
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
 * Cosa manca per vendere DOPO la proposta dell'assistente, letto dalla chat.
 *
 * La scheda di una proposta «Stato → In vendita» guardava il prodotto com'e'
 * adesso e ignorava il resto della stessa proposta: «Descrizione aggiornata ·
 * Stato → In vendita» stava sopra «Non si può ancora mettere in vendita: manca
 * la descrizione», e premendo Applica il server accettava (collaudo del 15/10).
 * Qui la scheda si legge come la leggera' il server: con i campi della
 * proposta sopra quelli attuali, senza le dichiarazioni (che l'assistente non
 * scrive) e senza un prezzo fuori banda (che il server scarta).
 */
export function cosaMancaDopoLaProposta(prodotto: SchedaDellaChat, proposta: AiProductPatch): string[] {
  const { patch } = separaCampiDichiarativi(proposta);
  const attributes: Record<string, unknown> = { ...prodotto.attributes };
  for (const [k, v] of Object.entries(patch.attributes ?? {})) {
    if (String(v ?? '').trim()) attributes[AI_ATTR_TO_FIELD[k] ?? k] = v;
  }
  for (const k of patch.attributes_remove ?? []) delete attributes[AI_ATTR_TO_FIELD[k] ?? k];
  const prezzoValido =
    typeof patch.price === 'number' && patch.price > 0 && !prezzoAiFuoriBanda(patch.price, prodotto.price);
  return cosaMancaNellaScheda({
    ...prodotto,
    name: typeof patch.name === 'string' && patch.name.trim() ? patch.name : prodotto.name,
    description:
      typeof patch.description === 'string' && patch.description.trim() ? patch.description : prodotto.description,
    price: prezzoValido ? patch.price! : prodotto.price,
    categorySlug: patch.category_slug || prodotto.categorySlug,
    attributes,
  });
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
 * R36 — Cosa mostra la scheda di una proposta che mette il prodotto in vendita.
 * `null` se la proposta non lo mette in vendita. Altrimenti: cosa manca ancora
 * (letto come lo leggera' il server) e le dichiarazioni con cui andrebbe in
 * vetrina, da rileggere prima di premere Applica.
 */
export function avvisoSullaPubblicazione(
  prodotto: SchedaDellaChat & { status: string },
  proposta: AiProductPatch,
): { mancanti: string[]; dichiarazioni: { etichetta: string; valore: string }[] } | null {
  if (proposta.status !== 'available' || prodotto.status === 'available') return null;
  return {
    mancanti: cosaMancaDopoLaProposta(prodotto, proposta),
    dichiarazioni: dichiarazioniInVetrina({
      ...prodotto,
      categorySlug: proposta.category_slug || prodotto.categorySlug,
    }),
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

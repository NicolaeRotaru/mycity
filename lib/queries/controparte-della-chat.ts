import { logger } from '@/lib/logger';
import { fetchSellerPublicMap, type LettoreVista } from '@/lib/queries/seller-public-profiles';

/**
 * IN CHAT, IL CLIENTE VEDE L'INSEGNA DEL NEGOZIO LETTA DALLA VETRINA PUBBLICA.
 *
 * 18/10/2026 (seconda ondata, squadra ordini) — L'elenco dei messaggi e la
 * conversazione prendevano il nome della controparte da `profiles`, agganciata
 * alla conversazione (`seller:profiles!conversations_seller_id_fkey`). Per il
 * cliente la controparte e' il negozio, e la sua insegna si leggeva solo grazie
 * alla regola «chiunque legge i negozi approvati», che le migrazioni 110, 112 e
 * 161 tolgono. Dopo, il cliente avrebbe letto «Utente» al posto del negozio a cui
 * sta scrivendo.
 *
 * L'insegna adesso arriva dalla vista `seller_public_profiles`, una domanda sola
 * per tutto l'elenco. Il nome del cliente visto dal negozio arriva dalla
 * migrazione 181 (31/10/2026, `NOMI_DEI_CLIENTI`, più sotto). Il nome dell'account
 * Assistenza è arrivato il 25/10/2026 (`conversazioneConLAssistenza`, più sotto).
 */

/**
 * 31/10/2026 (migrazione 181) — IL NEGOZIO LEGGE IL NOME DEI SUOI CLIENTI.
 *
 * Dopo la 161 `profiles` si legge solo per la propria riga: l'aggancio
 * `buyer:profiles!conversations_buyer_id_fkey` torna vuoto, e il negoziante
 * leggeva «Utente» al posto di ogni cliente. Il nome adesso lo dà la funzione
 * della 181, che restituisce solo id e nome, e solo delle persone che il
 * negozio ha già davanti (chat, ordini, recensioni).
 */
export const NOMI_DEI_CLIENTI = 'nomi_dei_clienti_del_negozio';

/** Quello che serve alla chat: la vetrina per le insegne, la funzione per i nomi dei clienti. */
export type LettoreChat = LettoreVista & {
  // Come `from`: i client Supabase hanno tipi generati diversi fra browser e server.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (nome: string, argomenti: Record<string, unknown>) => any;
};

/**
 * I nomi dei clienti che chi guarda ha davanti, per id. Se la funzione non
 * risponde (o non c'è ancora, prima della 181) la mappa è vuota e vale il
 * ripiego «Cliente»: il nome è un dettaglio, i messaggi no.
 */
async function nomiDeiClienti(supa: LettoreChat, ids: string[]): Promise<Map<string, string>> {
  const unici = [...new Set(ids)];
  if (unici.length === 0) return new Map();
  try {
    const { data, error } = await supa.rpc(NOMI_DEI_CLIENTI, { p_ids: unici });
    if (error) throw error;
    const righe = (data ?? []) as Array<{ id: string; full_name: string | null }>;
    return new Map(righe.filter((r) => !!r.full_name).map((r) => [r.id, r.full_name as string]));
  } catch (e) {
    logger.warn('[chat] nomi dei clienti non letti: conversazioni mostrate con «Cliente»', e);
    return new Map();
  }
}

/**
 * Attacca a ogni conversazione i nomi che `profiles` non dà più a chi guarda:
 * l'insegna del suo negozio (per il cliente) e, se si passa `chiGuarda`, il
 * nome del cliente nelle conversazioni in cui chi guarda è il negozio.
 *
 * Se la vetrina non risponde, le conversazioni restano, l'insegna e' `null` e
 * `insegnaNonLetta` e' vero (poi vale il ripiego di `nomeDellaControparte`):
 * l'insegna e' un dettaglio, i messaggi no. Prima un guasto della sola vista
 * spegneva l'elenco e la conversazione, anche per il negoziante, a cui
 * l'insegna non serve.
 */
export async function conInsegnaDelNegozio<T extends { seller_id: string; buyer_id?: string | null }>(
  supa: LettoreChat,
  conversazioni: T[],
  chiGuarda: string | null = null,
): Promise<Array<T & { insegna: string | null; insegnaNonLetta: boolean; cliente: string | null }>> {
  if (conversazioni.length === 0) return [];
  const idsClienti = chiGuarda
    ? conversazioni.filter((c) => c.seller_id === chiGuarda && c.buyer_id).map((c) => c.buyer_id as string)
    : [];
  const leggiInsegne = async (): Promise<Map<string, { store_name?: string | null }> | null> => {
    try {
      return await fetchSellerPublicMap(supa, conversazioni.map((c) => c.seller_id), 'id, store_name');
    } catch (e) {
      logger.warn('[chat] insegne non lette dalla vetrina: conversazioni mostrate senza insegna', e);
      return null;
    }
  };
  const [negozi, clienti] = await Promise.all([leggiInsegne(), nomiDeiClienti(supa, idsClienti)]);
  return conversazioni.map((c) => ({
    ...c,
    insegna: negozi?.get(c.seller_id)?.store_name ?? null,
    insegnaNonLetta: negozi === null,
    cliente: (c.seller_id === chiGuarda && c.buyer_id ? clienti.get(c.buyer_id) : null) ?? null,
  }));
}

type Persona = { full_name: string | null; store_name: string | null } | null;

/** Il nome con cui il cliente vede l'account Assistenza in chat. */
export const NOME_ASSISTENZA = 'Assistenza MyCity';

/** Al posto di «Utente» finché non si sa se dall'altra parte c'è l'Assistenza. */
export const NOME_IN_ARRIVO = '…';

/**
 * 31/10/2026 — Al posto di «Utente» quando la vetrina dei negozi non ha risposto:
 * il cliente deve capire che il nome non è stato letto, non che sta scrivendo a
 * uno sconosciuto. Esempio: Maria ha due conversazioni, con Pane Quotidiano e con
 * Salumeria Due, e con la vista giù le leggeva tutte e due come «U Utente».
 */
export const NOME_NON_LETTO = 'Nome non disponibile';

/** Per il negozio, dall'altra parte c'è sempre un cliente: il ripiego quando il nome non si legge. */
export const NOME_CLIENTE = 'Cliente';

/**
 * 25/10/2026 — Vero se, per il cliente, dall'altra parte c'è l'account Assistenza.
 *
 * L'Assistenza non è un negozio: non sta nella vetrina pubblica e il suo profilo
 * un cliente non lo legge, quindi né l'insegna né il profilo la riconoscono. La
 * riconosce solo il seller_id, confrontato con l'account che usa
 * /api/support/conversation (`idAssistenza`). Senza quell'id — rotta che non
 * risponde, pagina ancora in caricamento — si resta al comportamento di prima.
 */
export function conversazioneConLAssistenza(
  conversazione: { buyer_id: string; seller_id: string },
  userId: string | null,
  idAssistenza: string | null | undefined,
): boolean {
  return !!idAssistenza && conversazione.buyer_id === userId && conversazione.seller_id === idAssistenza;
}

/** L'insegna o il nome del negozio, se chi guarda può leggerlo; altrimenti `null`. */
function nomeDelNegozio(conversazione: { seller: Persona; insegna: string | null }): string | null {
  const negozio = conversazione.seller;
  return conversazione.insegna ?? negozio?.store_name ?? negozio?.full_name ?? null;
}

/**
 * Vero se, per chi guarda, questa conversazione non ha un nome da mostrare: è il
 * cliente e il negozio non si legge. Solo così può essere l'Assistenza, ed è solo
 * allora che vale la pena chiederlo al server. Un negozio con l'insegna, o il
 * negoziante che guarda i suoi clienti, non hanno bisogno della domanda.
 */
export function serveSapereChiEAssistenza(
  conversazione: { buyer_id: string; seller: Persona; insegna: string | null },
  userId: string | null,
): boolean {
  return !!userId && conversazione.buyer_id === userId && nomeDelNegozio(conversazione) === null;
}

/**
 * Vero mentre il nome di questa conversazione dipende ancora dalla risposta del
 * server. Le pagine lo usano per mostrare «…» con un testo per chi usa il lettore
 * di schermo, invece di confrontare il nome col testo «…»: un negozio può anche
 * chiamarsi così.
 */
export function nomeInArrivo(
  conversazione: { buyer_id: string; seller_id: string; seller: Persona; insegna: string | null },
  userId: string | null,
  idAssistenza: string | null,
  idInArrivo: boolean,
): boolean {
  return idInArrivo
    && serveSapereChiEAssistenza(conversazione, userId)
    && !conversazioneConLAssistenza(conversazione, userId, idAssistenza);
}

/**
 * Il nome di chi sta dall'altra parte, come lo legge chi guarda.
 *
 * Il cliente vede l'insegna del negozio (dalla vetrina, poi il ripiego di prima),
 * oppure «Assistenza MyCity» se scrive all'Assistenza; se la vetrina non ha
 * risposto, «Nome non disponibile». Il negozio, e l'Assistenza stessa, vedono il
 * nome del cliente (dalla 181, poi il ripiego di prima, poi «Cliente»).
 *
 * `idInArrivo`: la pagina sta ancora chiedendo chi è l'Assistenza. Una riga che
 * ricadrebbe su «Utente» potrebbe essere proprio l'Assistenza, e mostrare «Utente»
 * per poi cambiarlo era il difetto stesso: in quell'attesa si legge «…».
 */
export function nomeDellaControparte(
  conversazione: {
    buyer_id: string;
    seller_id: string;
    buyer: Persona;
    seller: Persona;
    insegna: string | null;
    insegnaNonLetta?: boolean;
    cliente?: string | null;
  },
  userId: string | null,
  idAssistenza: string | null = null,
  idInArrivo = false,
): string {
  const iAmBuyer = conversazione.buyer_id === userId;
  if (iAmBuyer) {
    if (conversazioneConLAssistenza(conversazione, userId, idAssistenza)) return NOME_ASSISTENZA;
    const nome = nomeDelNegozio(conversazione);
    if (nome) return nome;
    if (idInArrivo) return NOME_IN_ARRIVO;
    return conversazione.insegnaNonLetta ? NOME_NON_LETTO : 'Utente';
  }
  return conversazione.cliente ?? conversazione.buyer?.full_name ?? NOME_CLIENTE;
}

/** Quanto si aspetta la risposta prima di arrendersi: il nome è un dettaglio. */
export const TETTO_ATTESA_MS = 4000;

/**
 * Per quanto un id dell'Assistenza resta buono. Un id letto non cambia: un'ora. Un
 * «non c'è» invece può diventare vecchio subito — il cliente scrive all'Assistenza
 * da un'altra scheda — quindi si richiede alla prossima occasione, come ogni dato.
 */
export function validitaIdAssistenza(query: { state: { data: unknown } }): number {
  return typeof query.state.data === 'string' ? 60 * 60 * 1000 : 30 * 1000;
}

/**
 * Chiede al server quale account fa da Assistenza: `null` se chi chiama non ha una
 * conversazione con lei. Se la domanda fallisce LANCIA, così React Query riprova
 * invece di ricordarsi per un'ora un guasto come se fosse una risposta. Le pagine
 * trattano l'errore come `null`: la chat resta quella di prima e non si ferma,
 * perché il nome è un dettaglio e i messaggi no.
 *
 * `segnale` è quello di React Query: se la pagina si chiude, o il pulsante
 * Assistenza scrive l'id in memoria, la richiesta si ferma davvero. Il tetto di
 * attesa usa un timer suo, che si spegne appena la domanda finisce.
 */
export async function leggiIdAssistenza(segnale?: AbortSignal): Promise<string | null> {
  const controllo = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controllo ? setTimeout(() => controllo.abort(), TETTO_ATTESA_MS) : null;
  const inoltra = () => controllo?.abort();
  if (segnale?.aborted) inoltra();
  else segnale?.addEventListener('abort', inoltra, { once: true });
  try {
    const risposta = await fetch('/api/support/conversation', {
      method: 'GET',
      credentials: 'same-origin',
      signal: controllo?.signal,
    });
    if (!risposta.ok) throw new Error(`account Assistenza non letto: ${risposta.status}`);
    const corpo = (await risposta.json()) as { supportId?: unknown };
    return typeof corpo.supportId === 'string' && corpo.supportId ? corpo.supportId : null;
  } catch (e) {
    // Una domanda annullata da chi l'ha fatta non è un guasto da segnalare.
    if (!segnale?.aborted) logger.warn('[chat] account Assistenza non letto: la chat resta senza il suo nome', e);
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    segnale?.removeEventListener('abort', inoltra);
  }
}

import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TIPI_ATTIVITA } from './tipi-attivita';
import { indirizzoWebPubblico } from '@/lib/indirizzi-pubblici';

/**
 * UN CLIENTE NUOVO DAL MODULO 12 ENTRA IN MYCITY — 25/11/2026.
 *
 * Nicola: «modifica il modulo 12 e permetti di iscrivere un nuovo cliente dentro mycity». Le sue scelte
 * dello stesso giorno: il negozio nasce «come Ora del Gusto» (migrazione 708), cioè senza accesso e senza
 * email vera, fuori vetrina, col suo preventivo aperto da un link col codice che Nicola legge in
 * Admin → Preventivi col link e manda lui al titolare. Nessun messaggio parte da solo. La scheda del
 * locale non la scrive più l'API di Claude: la scrive l'AD col piano Max e arriva da /api/agenzia/scheda-cliente.
 *
 * Partono solo i dati dell'attività che il locale mostra al pubblico: nome, tipo, città, indirizzo.
 * Mai dati del titolare.
 */

export const NuovaAttivitaInArrivo = z.object({
  tipo: z.literal('nuova-attivita'),
  origine: z.string().trim().max(40).optional(),
  nome: z.string().trim().min(2, 'il nome è troppo corto').max(80, 'il nome è troppo lungo'),
  tipo_attivita: z.enum(TIPI_ATTIVITA).optional(),
  dettaglio: z.string().trim().max(80).optional(),
  citta: z.string().trim().max(60).optional(),
  indirizzo: z.string().trim().max(200).optional(),
  /** 25/11/2026 — Il sito del locale, se il modulo 12 lo conosce: va nei canali della vetrina e Google PageSpeed lo analizza. */
  sito: z.string().trim().max(300).optional(),
});
export type NuovaAttivita = z.infer<typeof NuovaAttivitaInArrivo>;

/** Il dominio delle email finte: nessuna posta parte mai verso questi indirizzi. */
export const DOMINIO_DI_SISTEMA = 'mycity-system.local';

const normalizza = (v: string | undefined) =>
  (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** L'email finta del negozio: stessa attività (nome + città) → stessa email, così due invii non creano due negozi. */
export function emailDiSistema(a: Pick<NuovaAttivita, 'nome' | 'citta'>): string {
  const base = normalizza(a.nome).replace(/ /g, '-').slice(0, 40) || 'attivita';
  const impronta = createHash('sha256').update(`${normalizza(a.nome)}|${normalizza(a.citta || 'piacenza')}`).digest('hex').slice(0, 10);
  return `${base}-${impronta}.preventivo@${DOMINIO_DI_SISTEMA}`;
}

/** Quanto può essere lungo il tipo descritto: il vincolo `profiles_business_type_detail_check` della migrazione 703. */
export const MAX_DETTAGLIO = 60;

/** Le parole che non chiudono una frase: un taglio che finisce su «e» o «di» si accorcia ancora di una parola. */
const CODA_SOSPESA = /[\s,;:.\-–—/(]+$|\s+(?:e|ed|o|di|da|in|con|per|del|della|dei|delle|degli|al|alla)$/i;

/**
 * Il tipo descritto («Bar, caffetteria e pasticceria…») accorciato a quello che il database accetta, tagliato
 * fra due parole; `undefined` se è vuoto.
 *
 * 28/11/2026 03:13 — Nicola, dalla pagina dell'agente: «Non sono riuscito ad aggiungere l'attività». La scheda
 * dell'AD descriveva il tipo con più di 60 caratteri, il codice ne lasciava passare 80 e il database ne
 * accetta 60: ogni «Aggiungi attività» falliva sul vincolo, sempre, e «riprova fra poco» non poteva
 * servire. Il tipo descritto è una didascalia: meglio corto che un negozio che non nasce.
 */
export function accorciaDettaglio(t: string | null | undefined): string | undefined {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  // Il database conta i caratteri, non le unità UTF-16: un'emoji vale uno, e non si spezza a metà.
  const caratteri = Array.from(s);
  if (caratteri.length <= MAX_DETTAGLIO) return s;
  const taglio = caratteri.slice(0, MAX_DETTAGLIO + 1).join('');
  const spazio = taglio.lastIndexOf(' ');
  let corto = spazio >= MAX_DETTAGLIO / 2 ? taglio.slice(0, spazio) : caratteri.slice(0, MAX_DETTAGLIO).join('');
  for (let i = 0; i < 3 && CODA_SOSPESA.test(corto); i += 1) corto = corto.replace(CODA_SOSPESA, '');
  return corto.trim() || caratteri.slice(0, MAX_DETTAGLIO).join('');
}

/** Il codice del link: 256 bit casuali, come la migrazione 708. */
export const nuovoCodice = (): string => randomBytes(32).toString('hex');

export type EsitoIscrizione =
  | { ok: true; id: string; nuova: boolean; sito: string | null }
  | { ok: false; motivo: 'gia-con-accesso' | 'guasto'; dettaglio?: string };

/** Cento anni: l'accesso resta chiuso finché il titolare non accetta il preventivo dal link. */
const BLOCCO_ACCESSO = '876000h';

/**
 * L'attività già iscritta con lo stesso nome e la stessa città (la stessa email di sistema), con l'indirizzo
 * che ha in vetrina; `null` se non c'è. 27/11/2026: serve al pulsante dell'agente per non fondere due negozi
 * diversi con lo stesso nome (collaudo: due «Bar Sport» a Piacenza diventavano uno).
 */
export async function attivitaGiaIscritta(admin: SupabaseClient, a: Pick<NuovaAttivita, 'nome' | 'citta'>): Promise<{ id: string; indirizzo: string | null } | null> {
  const email = emailDiSistema(a);
  const esistente = await admin
    .from('preventivi_con_codice')
    .select('seller_id, profiles!inner(store_name, store_address)')
    .eq('profiles.store_name', a.nome)
    .limit(5);
  const righe = (esistente.data ?? []) as Array<{ seller_id: string; profiles: { store_address?: string | null } | { store_address?: string | null }[] }>;
  for (const r of righe) {
    const u = await admin.auth.admin.getUserById(r.seller_id);
    if (u.data?.user && comeLoRiconosce(u.data.user, email)) {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      return { id: r.seller_id, indirizzo: p?.store_address ?? null };
    }
  }
  // Collaudo del 27/11: un nome scritto in un altro modo («BAR SPORT» e «Bar Sport») ha la stessa email ma non
  // si trova dal nome. Si cerca allora dall'email, solo fra gli utenti creati dal sito.
  const trovato = await utenteDallEmail(admin, email);
  if (!trovato.utente?.delSito) return null;
  const profilo = await admin.from('profiles').select('store_address').eq('id', trovato.utente.id).maybeSingle();
  return { id: trovato.utente.id, indirizzo: (profilo.data as { store_address?: string | null } | null)?.store_address ?? null };
}

/** Quanti utenti si guardano al massimo cercando un'email (10 pagine da 1000): il caso è raro, il tetto c'è. */
const PAGINE_UTENTI = 10;
const PER_PAGINA = 1000;

/**
 * Il segno dell'email di sistema sull'utente: `app_metadata.email_di_sistema`. 27/11/2026 (collaudo, difetto
 * grave): quando il titolare accetta il preventivo, la sua email prende il posto di quella finta
 * (lib/agenzia/preventivo-col-codice.ts). Senza un segno, un nuovo invio dello stesso negozio trovava libera
 * l'email finta e creava un secondo negozio col suo secondo link. `app_metadata` lo scrive solo il server:
 * nessuno può darselo da solo, quindi chi lo porta l'ha creato il sito.
 */
const SEGNO = 'email_di_sistema';

type UtenteAuth = { email?: string | null; app_metadata?: Record<string, unknown> | null };

/** Come si riconosce l'utente di quest'attività: dall'email (finché è quella finta) o dal segno; `null` se non è lui. */
function comeLoRiconosce(u: UtenteAuth, email: string): 'email' | 'segno' | null {
  if (u.app_metadata?.[SEGNO] === email) return 'segno';
  if ((u.email ?? '').toLowerCase() === email) return 'email';
  return null;
}

/**
 * Un utente ritrovato dall'email di sistema. `delSito`: l'ha creato il sito, perché è ancora bloccato (nessuno
 * si blocca da solo) o porta il segno.
 */
type UtenteTrovato = { id: string; bloccato: boolean; delSito: boolean };

/**
 * L'utente ritrovato dall'email di sistema, scorrendo gli utenti a pagine. `cercato: true` vuol dire che la
 * ricerca è arrivata in fondo: allora `utente: null` è un «non c'è» sicuro. Con `cercato: false` la lettura
 * non è riuscita o ha toccato il tetto, e `errore` dice perché. 27/11/2026 (collaudo del pulsante
 * dell'agente): serve quando un'iscrizione si è fermata a metà. Dallo stesso giorno riconosce anche l'utente
 * il cui titolare ha già accettato, dal segno dell'email di sistema.
 */
async function utenteDallEmail(admin: SupabaseClient, email: string): Promise<{ utente: UtenteTrovato | null; cercato: boolean; errore?: string }> {
  for (let page = 1; page <= PAGINE_UTENTI; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGINA });
    if (error || !data) return { utente: null, cercato: false, errore: `utenti non letti: ${error?.message ?? 'risposta vuota'}` };
    const u = data.users.find((x) => comeLoRiconosce(x, email) !== null);
    if (u) {
      const finoA = u.banned_until ? Date.parse(u.banned_until) : NaN;
      const bloccato = Number.isFinite(finoA) && finoA > Date.now();
      return { utente: { id: u.id, bloccato, delSito: bloccato || comeLoRiconosce(u, email) === 'segno' }, cercato: true };
    }
    // Ci si ferma sulla pagina vuota, non su quella corta: se il server desse pagine più piccole, fermarsi alla
    // prima pagina corta perderebbe l'utente in silenzio (idea della mycity#345).
    if (data.users.length === 0) return { utente: null, cercato: true };
  }
  return { utente: null, cercato: false, errore: `ricerca ferma ai primi ${PAGINE_UTENTI * PER_PAGINA} utenti` };
}

export async function iscriviAttivita(admin: SupabaseClient, a: NuovaAttivita): Promise<EsitoIscrizione> {
  const email = emailDiSistema(a);
  const guasto = (dettaglio: string): EsitoIscrizione => ({ ok: false, motivo: 'guasto', dettaglio });

  // 1. L'utente senza accesso, o quello già creato da un invio precedente con lo stesso nome e città.
  //    27/11/2026 (collaudo, difetto grave): lo si cerca PRIMA di crearlo. Dopo che il titolare ha accettato,
  //    l'email finta è di nuovo libera e `createUser` riusciva: nasceva un secondo negozio col suo link.
  let id: string | null = null;
  let nuova = false;
  let recuperata = false;
  let trovato = await utenteDallEmail(admin, email);
  if (!trovato.cercato) return guasto(trovato.errore ?? 'utenti non letti');
  if (!trovato.utente) {
    const creato = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { role: 'seller' },
      app_metadata: { [SEGNO]: email },
      ban_duration: BLOCCO_ACCESSO,
    });
    if (creato.data?.user) {
      id = creato.data.user.id;
      nuova = true;
    } else {
      // Un altro invio della stessa attività l'ha creato un attimo prima: lo si ritrova.
      trovato = await utenteDallEmail(admin, email);
      if (!trovato.utente) return guasto(trovato.errore ?? creato.error?.message ?? 'utente non creato');
    }
  }
  if (!id && trovato.utente) {
    const u = trovato.utente;
    const colLink = await admin.from('preventivi_con_codice').select('seller_id, stato').eq('seller_id', u.id).maybeSingle();
    if (colLink.error) return guasto(colLink.error.message);
    const link = colLink.data as { stato?: string | null } | null;
    if (link) {
      // Il titolare ha accettato (o Nicola ha chiuso il preventivo): il negozio non si riscrive e non ne nasce
      // un altro. Proposta del collaudo del 27/11.
      if ((link.stato ?? 'aperto') !== 'aperto') return { ok: false, motivo: 'gia-con-accesso' };
      // Col link l'iscrizione era finita. Un nome diverso con la stessa email vuol dire un'altra attività che
      // si scrive uguale («BAR SPORT» e «Bar Sport») o un negozio rinominato: come prima, non si tocca.
      const nome = await admin.from('profiles').select('store_name').eq('id', u.id).maybeSingle();
      if (nome.error) return guasto(nome.error.message);
      if ((nome.data as { store_name?: string | null } | null)?.store_name !== a.nome) {
        return guasto('stessa email di un’attività già iscritta con un altro nome');
      }
      id = u.id;
    } else {
      // Iscrizione fermata a metà: l'utente c'è, ma il profilo col link no. Il lavoro si finisce come la prima
      // volta: per chi chiama è un'attività che nasce adesso (flusso 16, avviso), perché la prima volta quei
      // passi non erano partiti. Solo un utente creato dal sito: un account registrato a mano con la stessa
      // email non diventa mai un negozio. «nuova» resta solo per chi scrive davvero il link (più sotto).
      if (!u.delSito) return guasto('con questa email c’è un account non creato dal sito');
      id = u.id;
      nuova = true;
      recuperata = true;
    }
  }
  if (!id) return guasto('utente non creato');

  // 2. Il profilo: venditore non approvato, fuori vetrina, coi dati pubblici dell'attività.
  const profilo = await admin.from('profiles').select('id, approval_status, is_approved').eq('id', id).maybeSingle();
  const p = profilo.data as { approval_status?: string | null; is_approved?: boolean } | null;
  if (p && (!nuova || recuperata) && (p.is_approved || (p.approval_status && p.approval_status !== 'pending'))) {
    // Il titolare ha già accettato o è stato approvato: il modulo non riscrive più niente.
    return { ok: false, motivo: 'gia-con-accesso' };
  }
  const valori: Record<string, unknown> = {
    role: 'seller',
    is_approved: false,
    approval_status: null,
    store_name: a.nome,
    offers_express: false,
  };
  // 27/11/2026 (collaudo) — Il tipo si scrive alla nascita, o quando chi iscrive lo sa: un secondo invio senza
  // tipo (il pulsante dell'agente, il modulo 12 rimandato) non cancella più quello scritto prima.
  if (a.tipo_attivita || nuova) valori.business_type = a.tipo_attivita ?? 'negozio';
  // 28/11/2026 — Accorciato a 60 caratteri, come vuole il database: chi iscrive ne può mandare fino a 80.
  if (a.dettaglio || nuova) valori.business_type_detail = accorciaDettaglio(a.dettaglio) ?? null;
  if (a.indirizzo) valori.store_address = a.citta && !a.indirizzo.toLowerCase().includes(a.citta.toLowerCase()) ? `${a.indirizzo}, ${a.citta}` : a.indirizzo;
  if (a.citta) valori.city = a.citta;
  // Il sito va nei canali della vetrina solo se è un indirizzo pubblico https, e solo alla nascita del
  // negozio: una vetrina che esiste già ha i canali scritti dal titolare, e non si toccano.
  const sito = indirizzoWebPubblico(a.sito);
  if (sito && nuova) valori.store_customization = { socials: { website: sito } };
  const scritto = await admin.from('profiles').upsert({ id, ...valori }, { onConflict: 'id' });
  if (scritto.error) return { ok: false, motivo: 'guasto', dettaglio: scritto.error.message };

  // 3. Il link col codice, una volta sola.
  const link = await admin
    .from('preventivi_con_codice')
    .upsert({ seller_id: id, codice: nuovoCodice() }, { onConflict: 'seller_id', ignoreDuplicates: true })
    .select('seller_id');
  if (link.error) return { ok: false, motivo: 'guasto', dettaglio: link.error.message };
  // ③ L'attività è «nuova» solo per l'invio che ha scritto il link adesso: il database restituisce la riga solo
  //    in quel caso. Due invii insieme sulla stessa attività rimasta a metà non fanno partire due volte il
  //    flusso 16 (idea della mycity#345, collaudo del 27/11).
  nuova = (link.data ?? []).length > 0;

  return { ok: true, id, nuova, sito };
}

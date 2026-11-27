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
    if (u.data?.user?.email === email) {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      return { id: r.seller_id, indirizzo: p?.store_address ?? null };
    }
  }
  // Collaudo del 27/11: un nome scritto in un altro modo («BAR SPORT» e «Bar Sport») ha la stessa email ma non
  // si trova dal nome. Si cerca allora dall'email, solo fra gli utenti creati dal sito (bloccati).
  const trovato = await utenteDallEmail(admin, email);
  if (!trovato.utente?.bloccato) return null;
  const profilo = await admin.from('profiles').select('store_address').eq('id', trovato.utente.id).maybeSingle();
  return { id: trovato.utente.id, indirizzo: (profilo.data as { store_address?: string | null } | null)?.store_address ?? null };
}

/** Quanti utenti si guardano al massimo cercando un'email (10 pagine da 1000): il caso è raro, il tetto c'è. */
const PAGINE_UTENTI = 10;
const PER_PAGINA = 1000;

/** Un utente ritrovato dall'email, con quello che serve per capire se l'ha creato il sito. */
type UtenteTrovato = { id: string; bloccato: boolean };

/**
 * L'utente ritrovato dalla sua email, scorrendo gli utenti a pagine; `utente: null` se non c'è o se la lettura
 * non riesce (e allora `errore` dice perché). 27/11/2026 (collaudo del pulsante dell'agente): serve quando
 * un'iscrizione si è fermata a metà — l'utente creato, il profilo o il link no. Prima lo si cercava solo dal
 * profilo col link, che in quel caso non c'è: l'attività restava bloccata per sempre su «Riprova fra poco».
 */
async function utenteDallEmail(admin: SupabaseClient, email: string): Promise<{ utente: UtenteTrovato | null; errore?: string }> {
  for (let page = 1; page <= PAGINE_UTENTI; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGINA });
    if (error || !data) return { utente: null, errore: `utenti non letti: ${error?.message ?? 'risposta vuota'}` };
    const u = data.users.find((x) => (x.email ?? '').toLowerCase() === email);
    if (u) {
      const finoA = u.banned_until ? Date.parse(u.banned_until) : NaN;
      return { utente: { id: u.id, bloccato: Number.isFinite(finoA) && finoA > Date.now() } };
    }
    // Ci si ferma sulla pagina vuota, non su quella corta: se il server desse pagine più piccole, fermarsi alla
    // prima pagina corta perderebbe l'utente in silenzio (idea della mycity#345).
    if (data.users.length === 0) return { utente: null, errore: 'utente esistente non ritrovato' };
  }
  return { utente: null, errore: `utente non ritrovato nei primi ${PAGINE_UTENTI * PER_PAGINA}` };
}

export async function iscriviAttivita(admin: SupabaseClient, a: NuovaAttivita): Promise<EsitoIscrizione> {
  const email = emailDiSistema(a);

  // 1. L'utente senza accesso (o quello già creato da un invio precedente con lo stesso nome e città).
  let id: string | null = null;
  let nuova = false;
  let recuperata = false;
  const creato = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { role: 'seller' },
    ban_duration: BLOCCO_ACCESSO,
  });
  if (creato.data?.user) {
    id = creato.data.user.id;
    nuova = true;
  } else {
    // Già creato prima: lo si ritrova dal profilo che porta il suo nome nel link col codice.
    const esistente = await admin
      .from('preventivi_con_codice')
      .select('seller_id, profiles!inner(store_name)')
      .eq('profiles.store_name', a.nome)
      .limit(5);
    const righe = (esistente.data ?? []) as Array<{ seller_id: string }>;
    for (const r of righe) {
      const u = await admin.auth.admin.getUserById(r.seller_id);
      if (u.data?.user?.email === email) {
        id = r.seller_id;
        break;
      }
    }
    if (!id) {
      // Iscrizione fermata a metà: l'utente c'è, ma il profilo col link no. Lo si ritrova dall'email e il
      // lavoro si finisce come la prima volta: per chi chiama è un'attività che nasce adesso (flusso 16,
      // avviso), perché la prima volta quei passi non erano partiti. Due paletti (collaudo del 27/11), e un
      // terzo più sotto: «nuova» solo per chi scrive davvero il link.
      const trovato = await utenteDallEmail(admin, email);
      const u = trovato.utente;
      if (!u) return { ok: false, motivo: 'guasto', dettaglio: trovato.errore ?? creato.error?.message ?? 'utente non creato' };
      // ① solo un utente creato dal sito, cioè bloccato: nessuno si blocca da solo. Un account registrato a
      //    mano con la stessa email non diventa mai un negozio.
      if (!u.bloccato) return { ok: false, motivo: 'guasto', dettaglio: 'con questa email c’è un account non creato dal sito' };
      // ② col link l'iscrizione era finita: il nome diverso vuol dire un'altra attività che si scrive uguale
      //    («BAR SPORT» e «Bar Sport») o un negozio rinominato. Come prima, non si tocca.
      const giaColLink = await admin.from('preventivi_con_codice').select('seller_id').eq('seller_id', u.id).maybeSingle();
      if (giaColLink.error) return { ok: false, motivo: 'guasto', dettaglio: giaColLink.error.message };
      if (giaColLink.data) return { ok: false, motivo: 'guasto', dettaglio: 'stessa email di un’attività già iscritta con un altro nome' };
      id = u.id;
      nuova = true;
      recuperata = true;
    }
  }

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
  if (a.dettaglio || nuova) valori.business_type_detail = a.dettaglio || null;
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

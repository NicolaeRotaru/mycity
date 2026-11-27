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

/** Gli utenti letti per pagina, e il tetto di pagine: 50.000 utenti prima di arrendersi con un «guasto». */
const UTENTI_PER_PAGINA = 1000;
const PAGINE_MASSIME = 50;

/**
 * 27/11/2026 (collaudo) — L'utente di sistema ritrovato dalla sua email, senza passare dal profilo né dal
 * link col codice: se il primo invio si è fermato dopo aver creato l'utente, quei due non esistono ancora.
 * Supabase Auth non cerca per email: si leggono gli utenti a pagine finché non spunta. `null` se non c'è;
 * `errore` se Supabase Auth non risponde.
 */
async function utenteDaEmail(admin: SupabaseClient, email: string): Promise<{ id: string | null; errore?: string }> {
  for (let pagina = 1; pagina <= PAGINE_MASSIME; pagina += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: UTENTI_PER_PAGINA });
    if (error) return { id: null, errore: error.message };
    const utenti = data?.users ?? [];
    const trovato = utenti.find((u) => u.email?.toLowerCase() === email);
    if (trovato) return { id: trovato.id };
    // Ci si ferma sulla pagina vuota, non su quella corta: se il server desse pagine più piccole di mille,
    // fermarsi alla prima pagina corta perderebbe l'utente in silenzio (collaudo del 27/11).
    if (utenti.length === 0) return { id: null };
  }
  return { id: null, errore: `utente non trovato nelle prime ${PAGINE_MASSIME * UTENTI_PER_PAGINA}` };
}

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
  return null;
}

export async function iscriviAttivita(admin: SupabaseClient, a: NuovaAttivita): Promise<EsitoIscrizione> {
  const email = emailDiSistema(a);

  // 1. L'utente senza accesso (o quello già creato da un invio precedente con lo stesso nome e città).
  let id: string | null = null;
  // `creatoOra`: l'utente nasce in questo invio. `nuova`: l'iscrizione si completa in questo invio — anche
  // quella di un primo invio rimasto a metà, che non aveva ancora il link e non era partita da nessuna parte.
  let creatoOra = false;
  let nuova = false;
  const creato = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { role: 'seller' },
    ban_duration: BLOCCO_ACCESSO,
  });
  if (creato.data?.user) {
    id = creato.data.user.id;
    creatoOra = true;
    nuova = true;
  } else {
    // Già creato prima: lo si ritrova dalla sua email di sistema (collaudo del 27/11: passando dal profilo
    // e dal link, un primo invio caduto dopo createUser lasciava l'attività bloccata per sempre).
    const trovato = await utenteDaEmail(admin, email);
    if (!trovato.id) return { ok: false, motivo: 'guasto', dettaglio: trovato.errore ?? creato.error?.message ?? 'utente non creato' };
    id = trovato.id;
    const linkPrima = await admin.from('preventivi_con_codice').select('seller_id').eq('seller_id', id).maybeSingle();
    if (linkPrima.error) return { ok: false, motivo: 'guasto', dettaglio: linkPrima.error.message };
    nuova = !linkPrima.data;
  }

  // 2. Il profilo: venditore non approvato, fuori vetrina, coi dati pubblici dell'attività.
  const profilo = await admin.from('profiles').select('id, approval_status, is_approved').eq('id', id).maybeSingle();
  const p = profilo.data as { approval_status?: string | null; is_approved?: boolean } | null;
  if (p && !creatoOra && (p.is_approved || (p.approval_status && p.approval_status !== 'pending'))) {
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

  // 3. Il link col codice, una volta sola. Il database restituisce la riga solo se l'ha scritta adesso.
  const link = await admin
    .from('preventivi_con_codice')
    .upsert({ seller_id: id, codice: nuovoCodice() }, { onConflict: 'seller_id', ignoreDuplicates: true })
    .select('seller_id');
  if (link.error) return { ok: false, motivo: 'guasto', dettaglio: link.error.message };
  // Per un utente ritrovato, l'iscrizione è nuova solo se il link l'ha scritto questo invio: due invii
  // arrivati insieme non fanno partire due volte il flusso 16 (collaudo del 27/11).
  if (!creatoOra) nuova = (link.data ?? []).length > 0;

  return { ok: true, id, nuova, sito };
}

import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TIPI_ATTIVITA } from './tipi-attivita';

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
  | { ok: true; id: string; nuova: boolean }
  | { ok: false; motivo: 'gia-con-accesso' | 'guasto'; dettaglio?: string };

/** Cento anni: l'accesso resta chiuso finché il titolare non accetta il preventivo dal link. */
const BLOCCO_ACCESSO = '876000h';

export async function iscriviAttivita(admin: SupabaseClient, a: NuovaAttivita): Promise<EsitoIscrizione> {
  const email = emailDiSistema(a);

  // 1. L'utente senza accesso (o quello già creato da un invio precedente con lo stesso nome e città).
  let id: string | null = null;
  let nuova = false;
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
    if (!id) return { ok: false, motivo: 'guasto', dettaglio: creato.error?.message ?? 'utente non creato' };
  }

  // 2. Il profilo: venditore non approvato, fuori vetrina, coi dati pubblici dell'attività.
  const profilo = await admin.from('profiles').select('id, approval_status, is_approved').eq('id', id).maybeSingle();
  const p = profilo.data as { approval_status?: string | null; is_approved?: boolean } | null;
  if (p && !nuova && (p.is_approved || (p.approval_status && p.approval_status !== 'pending'))) {
    // Il titolare ha già accettato o è stato approvato: il modulo non riscrive più niente.
    return { ok: false, motivo: 'gia-con-accesso' };
  }
  const valori: Record<string, unknown> = {
    role: 'seller',
    is_approved: false,
    approval_status: null,
    store_name: a.nome,
    offers_express: false,
    business_type: a.tipo_attivita ?? 'negozio',
    business_type_detail: a.dettaglio || null,
  };
  if (a.indirizzo) valori.store_address = a.citta && !a.indirizzo.toLowerCase().includes(a.citta.toLowerCase()) ? `${a.indirizzo}, ${a.citta}` : a.indirizzo;
  if (a.citta) valori.city = a.citta;
  const scritto = await admin.from('profiles').upsert({ id, ...valori }, { onConflict: 'id' });
  if (scritto.error) return { ok: false, motivo: 'guasto', dettaglio: scritto.error.message };

  // 3. Il link col codice, una volta sola.
  const link = await admin
    .from('preventivi_con_codice')
    .upsert({ seller_id: id, codice: nuovoCodice() }, { onConflict: 'seller_id', ignoreDuplicates: true });
  if (link.error) return { ok: false, motivo: 'guasto', dettaglio: link.error.message };

  return { ok: true, id, nuova };
}

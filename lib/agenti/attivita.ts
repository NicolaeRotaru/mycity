import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { FASCE as LISTINO, type Abbonamento, type ServizioAgenzia } from '@/lib/agenzia/preventivo';
import { fraseVisita } from '@/lib/agenzia/visita';
import { passiDiSdg, type Passo } from '@/lib/agenti/passi-di-sdg';

export { passiDiSdg, type Passo };

/**
 * L'ATTIVITÀ DI UN AGENTE, DOPO IL «SÌ» — 27/11/2026.
 *
 * Nicola, 27/11 17:25: quando il titolare conferma dal link, la pagina dell'agente «deve aggiornarsi e portarlo alla
 * pagina con su scritto tutte le cose che deve fare adesso SDG». Qui il server legge, per una scheda (`lavoro`), il
 * preventivo che ne è nato (migrazione 999c) e, se c'è, l'ordine di servizio di SDG; e compone i passi di SDG per
 * QUEL cliente nella fascia scelta. Un agente vede solo le attività che ha portato lui; l'admin tutte (come
 * app/api/agente/stato). Il link col codice torna solo finché il preventivo è aperto: dopo non serve più.
 */

export type StatoAttivita = 'aperto' | 'accettato' | 'chiuso';

export type AttivitaDopoIlSi = {
  stato: StatoAttivita;
  nome: string;
  fascia: Abbonamento | null;
  accettatoIl: string | null;
  visitaIl: string | null;
  visita: string;
  link: string | null;
  ordine: { pianoOrigine: 'sito' | 'ad'; pianoStato: string; contenuti: number; periodo: string | null } | null;
  passi: Passo[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fasciaValida = (f: unknown): f is Abbonamento => typeof f === 'string' && f in LISTINO;

/** L'attività nata da una scheda, se l'agente può vederla; `null` se non c'è o non è sua. Lancia solo per un guasto. */
export async function attivitaDelLavoro(admin: SupabaseClient, lavoro: string, chi: { email: string; admin: boolean }): Promise<AttivitaDopoIlSi | null> {
  if (!UUID.test(lavoro)) return null;
  const letto = await admin
    .from('preventivi_con_codice')
    .select('seller_id, codice, stato, fascia_scelta, accettato_il, agente_email, profiles!inner(store_name)')
    .eq('lavoro', lavoro.toLowerCase())
    .order('creato_il', { ascending: false })
    .limit(1);
  if (letto.error) throw new Error(`attività non letta: ${letto.error.message}`);
  const riga = (letto.data ?? [])[0] as unknown as {
    seller_id: string; codice: string; stato: StatoAttivita; fascia_scelta: string | null; accettato_il: string | null; agente_email: string | null;
    profiles: { store_name: string | null } | { store_name: string | null }[];
  } | undefined;
  if (!riga) return null;
  if (!chi.admin && (riga.agente_email ?? '') !== chi.email.trim().toLowerCase()) return null;

  const profilo = Array.isArray(riga.profiles) ? riga.profiles[0] : riga.profiles;
  const nome = String(profilo?.store_name ?? '').trim() || 'L’attività';
  const [ordineLetto, visitaLetta] = await Promise.all([
    admin.from('ordini_sdg').select('fascia, canone_centesimi, primo_mese_centesimi, visita_il, piano, piano_origine, piano_completo_stato, dati_attivita').eq('seller_id', riga.seller_id).maybeSingle(),
    // La data della visita la scrive la conferma del titolare (migrazione 999b): se la colonna non c'è, niente data.
    admin.from('preventivi_con_codice').select('visita_il').eq('seller_id', riga.seller_id).maybeSingle(),
  ]);
  const o = (ordineLetto.error ? null : ordineLetto.data) as {
    fascia: string; canone_centesimi: number | null; primo_mese_centesimi: number | null; visita_il: string | null;
    piano: { contenuti?: unknown[]; periodo?: { titolo?: string } } | null; piano_origine: 'sito' | 'ad'; piano_completo_stato: string;
    dati_attivita: { dallaScheda?: { servizi?: Partial<Record<ServizioAgenzia, string>> } | null } | null;
  } | null;
  const visitaIl = o?.visita_il ?? (visitaLetta.error ? null : ((visitaLetta.data as { visita_il?: string | null } | null)?.visita_il ?? null));
  const fascia = fasciaValida(o?.fascia) ? o.fascia : fasciaValida(riga.fascia_scelta) ? riga.fascia_scelta : null;
  const accettato = riga.stato === 'accettato';

  return {
    stato: riga.stato,
    nome,
    fascia,
    accettatoIl: riga.accettato_il,
    visitaIl,
    visita: fraseVisita(visitaIl),
    link: riga.stato === 'aperto' && /^[0-9a-f]{64}$/.test(riga.codice) ? `${env.appUrl()}/preventivo/${riga.codice}` : null,
    ordine: o
      ? { pianoOrigine: o.piano_origine, pianoStato: o.piano_completo_stato, contenuti: Array.isArray(o.piano?.contenuti) ? o.piano.contenuti.length : 0, periodo: o.piano?.periodo?.titolo ?? null }
      : null,
    passi: accettato && fascia
      ? passiDiSdg({
          nome, fascia, visitaIl,
          canoneCentesimi: o?.canone_centesimi ?? null,
          primoMeseCentesimi: o?.primo_mese_centesimi ?? null,
          pianoNellOrdine: o ? { origine: o.piano_origine, stato: o.piano_completo_stato } : null,
          suMisura: o?.dati_attivita?.dallaScheda?.servizi ?? null,
        })
      : [],
  };
}

/** Le attività che il titolare ha già confermato, portate da questo agente (le ultime 20), per riaprirne la pagina. */
export async function attivitaConfermate(admin: SupabaseClient, email: string): Promise<{ lavoro: string; nome: string }[]> {
  const { data, error } = await admin
    .from('preventivi_con_codice')
    .select('lavoro, accettato_il, profiles!inner(store_name)')
    .eq('agente_email', email.trim().toLowerCase())
    .eq('stato', 'accettato')
    .not('lavoro', 'is', null)
    .order('accettato_il', { ascending: false })
    .limit(20);
  if (error || !data) return [];
  return (data as unknown as { lavoro: string; profiles: { store_name: string | null } | { store_name: string | null }[] }[])
    .filter((r) => UUID.test(String(r.lavoro)))
    .map((r) => {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      return { lavoro: r.lavoro, nome: String(p?.store_name ?? '').trim() || 'Attività' };
    });
}

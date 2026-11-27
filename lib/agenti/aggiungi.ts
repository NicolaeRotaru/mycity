import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { NuovaAttivitaInArrivo, type NuovaAttivita } from '@/lib/agenzia/nuova-attivita';
import type { TipoAttivita } from '@/lib/agenzia/tipi-attivita';
import type { Scheda } from '@/lib/agenti/scheda';

/**
 * «AGGIUNGI ATTIVITÀ» DALLA PAGINA DELL'AGENTE — 27/11/2026.
 *
 * Nicola, 26-27/11: prima la proposta, poi il preventivo; il preventivo nasce solo quando il titolare dice
 * «sì, voglio aderire», e allora va fatto «con un clic dalla stessa pagina». Qui si passa dalla scheda
 * dell'agente ai dati che servono per iscrivere l'attività come fa il flusso 20: SOLO i dati pubblici
 * dell'attività (nome, città, indirizzo, tipo, sito), mai quelli del titolare.
 */

/** Il tipo libero della scheda («Bar, caffetteria e pasticceria») nei sei tipi del sito, quando si capisce. */
export function tipoDaTesto(t: string | null | undefined): TipoAttivita | undefined {
  const s = String(t ?? '').toLowerCase();
  if (!s) return undefined;
  if (/ristorant|trattori|osteri|pizzeri/.test(s)) return 'ristorante';
  if (/\bbar\b|caff[eè]|pasticc|gelater|enotec|pub\b/.test(s)) return 'bar';
  if (/artigian|laborator|sartori|falegnam|calzolai/.test(s)) return 'artigiano';
  if (/parrucch|estetic|palestr|fitness|studio|agenzi|servizi|lavanderi/.test(s)) return 'servizi';
  if (/negozi|bottega|alimentar|panific|forno|macelleri|frutt|fior|librer|ottic|abbigliament|ferrament|gastronomi/.test(s)) return 'negozio';
  return undefined;
}

/**
 * I dati per iscrivere l'attività, letti dalla scheda. Il sito entra solo se il programma l'ha aperto davvero
 * (misura `aperto`) e in https: un sito solo indovinato o non raggiungibile non va nei canali della vetrina.
 * Restituisce `null` se la scheda non basta (manca il nome) o i dati non passano lo stesso controllo del 20.
 */
export function attivitaDallaScheda(scheda: Scheda): NuovaAttivita | null {
  const misura = scheda.sito?.misura;
  const sito = misura?.aperto && /^https:\/\//i.test(misura.url) ? misura.url : undefined;
  const tipo = tipoDaTesto(scheda.tipo);
  const candidato = {
    tipo: 'nuova-attivita' as const,
    origine: 'agente',
    nome: String(scheda.nome ?? '').trim().slice(0, 80),
    ...(tipo ? { tipo_attivita: tipo } : {}),
    ...(scheda.tipo ? { dettaglio: scheda.tipo.trim().slice(0, 80) } : {}),
    ...(scheda.citta ? { citta: scheda.citta.trim().slice(0, 60) } : {}),
    ...(scheda.indirizzo ? { indirizzo: scheda.indirizzo.trim().slice(0, 200) } : {}),
    ...(sito ? { sito: sito.slice(0, 300) } : {}),
  };
  const esito = NuovaAttivitaInArrivo.safeParse(candidato);
  return esito.success ? esito.data : null;
}

/** Il link del preventivo col codice di un'attività, o `null` se il link non c'è o non si legge. */
export async function linkDelPreventivo(admin: SupabaseClient, idAttivita: string): Promise<string | null> {
  const { data, error } = await admin.from('preventivi_con_codice').select('codice').eq('seller_id', idAttivita).maybeSingle();
  if (error || !data) return null;
  const codice = String((data as { codice?: unknown }).codice ?? '');
  return /^[0-9a-f]{64}$/.test(codice) ? `${env.appUrl()}/preventivo/${codice}` : null;
}

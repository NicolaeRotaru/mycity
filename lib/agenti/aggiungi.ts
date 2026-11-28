import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { accorciaDettaglio, NuovaAttivitaInArrivo, type NuovaAttivita } from '@/lib/agenzia/nuova-attivita';
import type { TipoAttivita } from '@/lib/agenzia/tipi-attivita';
import type { Scheda } from '@/lib/agenti/scheda';
import { NON_E_UN_SITO } from '@/lib/agenti/sito';
import type { ServiziScelti } from '@/lib/agenzia/servizi-scelti';

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

/** Il nome che la scheda mette quando non ne trova uno (lib/agenti/scheda.ts): non è un'attività da iscrivere. */
const SENZA_NOME = /^attivit[aà] senza nome$/i;

/**
 * Perché un nome non si può usare per iscrivere un'attività, o `null` se va bene. L'agente può anche scriverlo
 * a mano: un numero di telefono, un'email o un indirizzo web dentro il nome sono dati di persone o spazzatura,
 * e non vanno in vetrina (collaudo del 27/11).
 */
export function nomeNonValido(nome: string): string | null {
  const n = nome.trim();
  if (n.length < 2 || SENZA_NOME.test(n)) return 'Nella scheda manca il nome dell’attività.';
  if (/@[a-z0-9-]+\.[a-z]{2,}/i.test(n) || /https?:\/\/|www\./i.test(n)) return 'Il nome dell’attività contiene un’email o un indirizzo web: rifai la scheda col link di Google Maps.';
  if ((n.match(/[\d+][\d .\/-]*\d/g) ?? []).some((x) => x.replace(/\D/g, '').length >= 8)) return 'Il nome dell’attività contiene un numero di telefono: rifai la scheda col link di Google Maps.';
  return null;
}

/** Due indirizzi sono lo stesso posto? Si confrontano lettere e numeri, senza maiuscole, spazi e punteggiatura. */
export function stessoIndirizzo(a: string | null | undefined, b: string | null | undefined): boolean {
  const pulito = (x: string | null | undefined) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const x = pulito(a);
  const y = pulito(b);
  if (!x || !y) return true;
  return x.includes(y) || y.includes(x);
}

/**
 * I dati per iscrivere l'attività, letti dalla scheda. Il sito entra solo se il programma l'ha aperto davvero
 * (misura `aperto`) e in https: un sito solo indovinato o non raggiungibile non va nei canali della vetrina.
 * Restituisce `null` se la scheda non basta (manca il nome) o i dati non passano lo stesso controllo del 20.
 */
const nonEUnSito = (url: string) => { try { return NON_E_UN_SITO.test(new URL(url).hostname); } catch { return true; } };

export function attivitaDallaScheda(scheda: Scheda): NuovaAttivita | null {
  const misura = scheda.sito?.misura;
  // 28/11/2026 — E mai un profilo o un elenco, anche se una misura vecchia lo dice aperto (collaudo).
  const sito = misura?.aperto && /^https:\/\//i.test(misura.url) && !nonEUnSito(misura.url) ? misura.url : undefined;
  const tipo = tipoDaTesto(scheda.tipo);
  const dettaglio = accorciaDettaglio(scheda.tipo);
  const candidato = {
    tipo: 'nuova-attivita' as const,
    origine: 'agente',
    nome: String(scheda.nome ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80),
    ...(tipo ? { tipo_attivita: tipo } : {}),
    // 28/11/2026 — Il tipo descritto entra già alla misura del database (60 caratteri), tagliato fra due parole.
    ...(dettaglio ? { dettaglio } : {}),
    ...(scheda.citta ? { citta: scheda.citta.trim().slice(0, 60) } : {}),
    ...(scheda.indirizzo ? { indirizzo: scheda.indirizzo.trim().slice(0, 200) } : {}),
    ...(sito ? { sito: sito.slice(0, 300) } : {}),
  };
  if (nomeNonValido(candidato.nome)) return null;
  const esito = NuovaAttivitaInArrivo.safeParse(candidato);
  return esito.success ? esito.data : null;
}

/**
 * 27/11/2026 — Chi ha portato il cliente, scritto sul preventivo (migrazione 999c): la scheda dell'agente (`lavoro`)
 * e la sua email. Serve a due cose: la pagina dell'agente sa quando il titolare conferma e lo porta a «Adesso tocca
 * a SDG», e l'ordine di servizio per SDG dice quale agente l'ha portato (lib/agenzia/ordine-sdg.ts). Si scrive solo a
 * preventivo aperto: chi preme «Sì, aggiungi» per ultimo prima della conferma è chi segue il cliente. Senza la 999c
 * la colonna non c'è: si va avanti senza, e l'agente ha il suo link come prima. Vero se è scritto.
 */
export async function segnaChiHaPortatoIlCliente(admin: SupabaseClient, idAttivita: string, chi: { lavoro: string; agenteEmail: string }): Promise<boolean> {
  const email = chi.agenteEmail.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chi.lavoro) || !email.includes('@')) return false;
  try {
    const { error } = await admin.from('preventivi_con_codice').update({ lavoro: chi.lavoro.toLowerCase(), agente_email: email }).eq('seller_id', idAttivita).eq('stato', 'aperto');
    return !error;
  } catch {
    return false;
  }
}

/**
 * 28/11/2026 — Quali servizi gli servono, scelti dall'agente insieme all'abbonamento (migrazione 999h): vanno sul
 * preventivo aperto, e all'accettazione passano nell'ordine di SDG (lib/agenzia/ordine-sdg.ts), dove decidono quali
 * lavori dell'AD partono. Senza la 999h le colonne non ci sono: si va avanti senza, e valgono tutti e quattro.
 * Vero se è scritto.
 */
export async function segnaIServiziScelti(admin: SupabaseClient, idAttivita: string, b: ServiziScelti): Promise<boolean> {
  if (!b.servizi.length) return false;
  try {
    const { error } = await admin.from('preventivi_con_codice').update({ servizi_scelti: b.servizi, nota_agente: b.nota }).eq('seller_id', idAttivita).eq('stato', 'aperto');
    return !error;
  } catch {
    return false;
  }
}

/** Il link del preventivo col codice di un'attività, o `null` se il link non c'è o non si legge. */
export async function linkDelPreventivo(admin: SupabaseClient, idAttivita: string): Promise<string | null> {
  const { data, error } = await admin.from('preventivi_con_codice').select('codice').eq('seller_id', idAttivita).maybeSingle();
  if (error || !data) return null;
  const codice = String((data as { codice?: unknown }).codice ?? '');
  return /^[0-9a-f]{64}$/.test(codice) ? `${env.appUrl()}/preventivo/${codice}` : null;
}

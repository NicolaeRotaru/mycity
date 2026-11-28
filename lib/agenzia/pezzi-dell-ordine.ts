import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { adCollegato, avviaLavoro, leggiLavoro } from '@/lib/agenti/n8n';
import { normalizza, pulisci, unisci, type Scheda } from '@/lib/agenti/scheda';
import { FLUSSO } from '@/lib/agenti/compito';
import type { Abbonamento } from './preventivo';
import type { DatiAttivita, StatoPianoCompleto } from './ordine-sdg';
import { VENDITORE_DEI_PIANI, dallaSchedaDellAgente } from './piano-completo-ad';
import { COMPITO_SITO, SCHEMA_SITO, datiPerIlSito, sitoDallaRisposta, type BozzaSitoOrdine } from './sito-dell-ordine-ad';
import { leggiServiziScelti } from './servizi-scelti';
import { COMPITO_ANALISI, SCHEMA_ANALISI, analisiDallaRisposta, datiPerLAnalisi, type AnalisiAvvioOrdine } from './analisi-dell-ordine-ad';

/**
 * IL SITO E L'ANALISI DELL'ORDINE DI SDG — 28/11/2026 (migrazione 999h).
 *
 * Nicola, 28/11 verso le 00:55: quando il cliente accetta, nascono in automatico, in base all'abbonamento, il sito,
 * il piano editoriale e l'analisi del business. Il piano ha la sua strada (lib/agenzia/ordine-sdg.ts →
 * chiediIlPianoCompleto); sito e analisi, i due «pezzi» nuovi, seguono lo stesso stampo, colonna per colonna:
 *   <pezzo>          il lavoro pronto (jsonb), solo quando lo stato è «pronto»
 *   <pezzo>_stato    da_collegare · in_corso · pronto · errore
 *   lavoro_<pezzo>   il codice del lavoro mandato all'AD, mentre è in corso
 *   <pezzo>_errore   perché non è arrivato
 *   <pezzo>_il       quando è arrivato
 * Le funzioni qui NON LANCIANO MAI: un pezzo che non parte resta «da collegare» col motivo, e si richiede dalla
 * pagina di SDG. L'accettazione del titolare non aspetta niente di tutto questo (parte dopo la risposta).
 * Prima della 999h le colonne non ci sono: la lettura fallisce, il pezzo dice «manca la migrazione 999h».
 */

export type PezzoOrdine = 'sito' | 'analisi';
export const PEZZI_ORDINE: readonly PezzoOrdine[] = ['sito', 'analisi'];

export type ColonnePezzi = {
  sito: BozzaSitoOrdine | null;
  sito_stato: StatoPianoCompleto;
  lavoro_sito: string | null;
  sito_errore: string | null;
  sito_il: string | null;
  analisi: AnalisiAvvioOrdine | null;
  analisi_stato: StatoPianoCompleto;
  lavoro_analisi: string | null;
  analisi_errore: string | null;
  analisi_il: string | null;
};

export const COLONNE_PEZZI = 'sito, sito_stato, lavoro_sito, sito_errore, sito_il, analisi, analisi_stato, lavoro_analisi, analisi_errore, analisi_il';

/** Quello che serve per chiedere un pezzo: i dati del locale e la fascia, mai l'agente o la visita. */
type OrdinePerIPezzi = ColonnePezzi & { id: string; nome_attivita: string; dati_attivita: DatiAttivita; fascia: Abbonamento; lavoro: string | null; aggiornato_il: string };
const COLONNE_PER_I_PEZZI = `id, nome_attivita, dati_attivita, fascia, lavoro, aggiornato_il, ${COLONNE_PEZZI}`;

/** I pezzi «vuoti», per un ordine letto prima della 999h: nessuno è partito, nessuno si può chiedere. */
export const PEZZI_PRIMA_DELLA_999H: ColonnePezzi = {
  sito: null, sito_stato: 'da_collegare', lavoro_sito: null, sito_errore: 'manca la migrazione 999h', sito_il: null,
  analisi: null, analisi_stato: 'da_collegare', lavoro_analisi: null, analisi_errore: 'manca la migrazione 999h', analisi_il: null,
};

/** Dopo quanto un pezzo chiesto all'AD e non tornato si dà per perso (come il piano: l'AD aspetta al massimo 15 minuti). */
export const ATTESA_MASSIMA_PEZZO_MS = 45 * 60_000;

const NOME: Record<PezzoOrdine, string> = { sito: 'la bozza del sito', analisi: 'l’analisi all’avvio' };
const col = (p: PezzoOrdine) => ({ dato: p, stato: `${p}_stato`, lavoro: `lavoro_${p}`, errore: `${p}_errore`, il: `${p}_il` }) as const;

/** La scheda dell'agente, letta da n8n e pulita come la legge la sua pagina; `null` se non c'è o non si legge. */
export async function schedaDellAgente(lavoro: string | null): Promise<Scheda | null> {
  if (!lavoro) return null;
  const r = await leggiLavoro(lavoro);
  if (r.stato === 'sconosciuto') return null;
  const prima = normalizza(r.prima);
  if (!prima) return null;
  return r.stato === 'pronta' ? unisci(prima, pulisci(r.risultato), r.avvisi ?? []) : prima;
}

export type EsitoRichiestaPezzo = { esito: 'chiesto' | 'non-serve' | 'non-partito' | 'guasto'; dettaglio?: string };

/**
 * Chiede all'AD un pezzo dell'ordine, una volta: solo se è «da collegare». Lo prende con un aggiornamento
 * condizionato prima di mandare il lavoro, così due richieste insieme non fanno due lavori (due corse). Se n8n non
 * risponde, il pezzo torna «da collegare» col motivo. Non lancia mai.
 */
export async function chiediIlPezzo(ordineId: string, pezzo: PezzoOrdine): Promise<EsitoRichiestaPezzo> {
  try {
    const c = col(pezzo);
    const admin = getAdminSupabase();
    const letto = await admin.from('ordini_sdg').select(COLONNE_PER_I_PEZZI).eq('id', ordineId).maybeSingle();
    if (letto.error) return { esito: 'guasto', dettaglio: /column|does not exist/i.test(letto.error.message) ? 'manca la migrazione 999h' : letto.error.message };
    if (!letto.data) return { esito: 'guasto', dettaglio: 'ordine non trovato' };
    const o = letto.data as unknown as OrdinePerIPezzi;
    if (o[c.stato] !== 'da_collegare') return { esito: 'non-serve' };

    if (!adCollegato()) {
      await admin.from('ordini_sdg').update({ [c.errore]: 'il collegamento con l’AD non è acceso (manca N8N_SCHEDA_SEGRETO)', aggiornato_il: new Date().toISOString() }).eq('id', o.id).eq(c.stato, 'da_collegare');
      return { esito: 'non-partito', dettaglio: 'collegamento con l’AD non acceso' };
    }

    const lavoro = randomUUID();
    const presa = await admin
      .from('ordini_sdg')
      .update({ [c.stato]: 'in_corso', [c.lavoro]: lavoro, [c.errore]: null, aggiornato_il: new Date().toISOString() })
      .eq('id', o.id)
      .eq(c.stato, 'da_collegare')
      .select('id');
    if (presa.error) return { esito: 'guasto', dettaglio: presa.error.message };
    if (!presa.data || presa.data.length === 0) return { esito: 'non-serve' };

    // La scheda dell'agente la leggiamo dopo la presa: un secondo clic non fa una seconda lettura a n8n.
    const scheda = await schedaDellAgente(o.lavoro).catch(() => null);
    const locale = {
      nome: o.nome_attivita,
      tipo: scheda?.tipo ?? o.dati_attivita?.dallaScheda?.tipo ?? o.dati_attivita?.dettaglio ?? o.dati_attivita?.tipo ?? 'altro',
      citta: o.dati_attivita?.citta ?? scheda?.citta ?? 'Piacenza',
      indirizzo: o.dati_attivita?.indirizzo ?? scheda?.indirizzo ?? null,
      fascia: o.fascia,
      scheda: dallaSchedaDellAgente(scheda, o.fascia),
      // 28/11 — La nota dell'agente, scritta nell'ordine dal preventivo: un'indicazione, mai un testo da pubblicare.
      nota: leggiServiziScelti(o.dati_attivita?.servizi, o.dati_attivita?.notaAgente).nota,
    };
    const job = pezzo === 'sito'
      ? { flusso: FLUSSO, compito: COMPITO_SITO, schema: SCHEMA_SITO, dati: datiPerIlSito(locale) }
      : { flusso: FLUSSO, compito: COMPITO_ANALISI, schema: SCHEMA_ANALISI, dati: datiPerLAnalisi(locale) };
    const etichetta = pezzo === 'sito' ? 'Sito' : 'Analisi';
    const prima = { nome: o.nome_attivita, lavoro: pezzo === 'sito' ? 'bozza-sito' : 'analisi-avvio', fascia: o.fascia };
    const partito = await avviaLavoro(lavoro, VENDITORE_DEI_PIANI, `${etichetta} · ${o.nome_attivita}`.slice(0, 120), prima, job);
    if (partito.ok) return { esito: 'chiesto' };
    await admin
      .from('ordini_sdg')
      .update({ [c.stato]: 'da_collegare', [c.lavoro]: null, [c.errore]: `l’AD non è partito: ${partito.errore ?? 'n8n non risponde'}`.slice(0, 400), aggiornato_il: new Date().toISOString() })
      .eq('id', o.id)
      .eq(c.lavoro, lavoro);
    return { esito: 'non-partito', dettaglio: partito.errore };
  } catch (e) {
    logger.warn(`[ordine-sdg] ${NOME[pezzo]} non chiesta`, { ordineId, errore: String(e) });
    return { esito: 'guasto', dettaglio: String(e) };
  }
}

/**
 * Guarda se un pezzo «in corso» è tornato: se è pronto e regge i controlli entra nell'ordine; se l'AD ha sbagliato,
 * ha scritto un prezzo o un dato inventato, o non risponde da troppo, l'ordine lo dice. Restituisce l'ordine aggiornato.
 */
export async function aggiornaIlPezzo<T extends ColonnePezzi & { id: string; fascia: Abbonamento; nome_attivita: string; aggiornato_il: string; dati_attivita?: DatiAttivita | null }>(
  admin: SupabaseClient, o: T, pezzo: PezzoOrdine, adesso = Date.now(),
): Promise<T> {
  const c = col(pezzo);
  const lavoro = o[c.lavoro];
  if (o[c.stato] !== 'in_corso' || !lavoro) return o;
  try {
    const r = await leggiLavoro(lavoro);
    let cambio: Record<string, unknown> | null = null;
    if (r.stato === 'pronta' && r.venditore === VENDITORE_DEI_PIANI) {
      const esito = pezzo === 'sito' ? sitoDallaRisposta(r.risultato, o.fascia, o.nome_attivita) : analisiDallaRisposta(r.risultato, o.fascia, o.nome_attivita);
      cambio = esito.ok
        ? { [c.dato]: 'sito' in esito ? esito.sito : esito.analisi, [c.stato]: 'pronto', [c.errore]: null, [c.il]: new Date(adesso).toISOString() }
        : { [c.stato]: 'errore', [c.errore]: esito.motivo.slice(0, 400) };
    } else if (r.stato === 'errore') {
      cambio = { [c.stato]: 'errore', [c.errore]: `l’AD non è riuscito a finire: ${r.errore ?? 'senza motivo'}`.slice(0, 400) };
    } else if (adesso - Date.parse(o.aggiornato_il) > ATTESA_MASSIMA_PEZZO_MS) {
      cambio = { [c.stato]: 'errore', [c.errore]: 'l’AD non ha risposto in 45 minuti' };
    }
    if (!cambio) return o;
    const { error } = await admin.from('ordini_sdg').update({ ...cambio, aggiornato_il: new Date(adesso).toISOString() }).eq('id', o.id).eq(c.lavoro, lavoro).eq(c.stato, 'in_corso');
    if (error) {
      logger.warn(`[ordine-sdg] ${NOME[pezzo]} non salvata`, { ordineId: o.id, message: error.message });
      return o;
    }
    return { ...o, ...cambio };
  } catch (e) {
    logger.warn(`[ordine-sdg] ${NOME[pezzo]} non letta`, { ordineId: o.id, errore: String(e) });
    return o;
  }
}

/** Rimette «da collegare» un pezzo andato storto, perché lo si possa richiedere. Uno pronto o in corso non si tocca. */
export async function riapriIlPezzo(admin: SupabaseClient, ordineId: string, pezzo: PezzoOrdine): Promise<boolean> {
  const c = col(pezzo);
  const { data, error } = await admin
    .from('ordini_sdg')
    .update({ [c.stato]: 'da_collegare', [c.lavoro]: null, aggiornato_il: new Date().toISOString() })
    .eq('id', ordineId)
    .eq(c.stato, 'errore')
    .select('id');
  return !error && (data ?? []).length > 0;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { campiPerIlProfilo, leggiSchedaSalvata } from './scheda-cliente';

/**
 * AL PRIMO ABBONAMENTO PAGATO NASCONO LA SCHEDA DEL CLIENTE E LA PAGELLA — 25/11/2026.
 *
 * Nicola, 25/11: la scheda del cliente e la pagella sul marketplace arrivano solo dopo l'abbonamento
 * (lib/agenzia/scheda-dopo-abbonamento.ts). Quando arriva il primo pagamento di un abbonamento ai
 * servizi (lib/stripe/webhook/servizi.ts), qui:
 *  1. la scheda si apre: l'indirizzo confermato del locale entra nel profilo, se il profilo non ce l'ha
 *     già (le stesse regole di `campiPerIlProfilo`: solo l'indirizzo, mai il telefono). Tutto il resto
 *     della scheda il titolare lo vede da adesso nella sua dashboard, da confermare;
 *  2. il sito avvisa n8n, e parte il flusso 18 «Analisi di un'attività»: la pagella va a Nicola su
 *     Telegram. La pagella nella pagina del negozio la calcola già il sito da solo.
 *
 * L'AVVISO A n8n È SPENTO FINCHÉ NICOLA NON LO COLLEGA. Servono tutti e due:
 * `N8N_PAGELLA_WEBHOOK_URL` (solo https: il webhook del flusso 18,
 * https://n8n-shdy.sliplane.app/webhook/mycity-analisi-attivita) e `N8N_NUOVO_CLIENTE_SEGRETO` (il 18 è
 * protetto dallo stesso segreto del 16, la credenziale «MyCity - Segreto nuovo cliente»).
 * Partono solo l'id dell'attività e da dove arriva: il 18 legge il resto dal database, senza dati personali.
 *
 * Non blocca mai il pagamento: se n8n non risponde in 5 secondi, o risponde male, l'abbonamento è già
 * scritto e il log dice cosa non è partito.
 */

const ATTESA_MASSIMA_MS = 5_000;
const INTESTAZIONE_SEGRETO = 'x-mycity-segreto';

export type EsitoAvviso = 'spento' | 'inviato' | 'fallito';

export async function avvisaN8nAbbonamentoAttivo(idAttivita: string, fetchFn: typeof fetch = fetch): Promise<EsitoAvviso> {
  const indirizzo = process.env.N8N_PAGELLA_WEBHOOK_URL?.trim();
  if (!indirizzo) return 'spento';
  if (!/^https:\/\//i.test(indirizzo)) {
    logger.warn('[abbonamento-attivo] N8N_PAGELLA_WEBHOOK_URL non è https: la pagella non parte');
    return 'fallito';
  }
  const segreto = process.env.N8N_NUOVO_CLIENTE_SEGRETO?.trim();
  if (!segreto) {
    logger.warn('[abbonamento-attivo] manca N8N_NUOVO_CLIENTE_SEGRETO: n8n respingerebbe la richiesta, la pagella non parte');
    return 'fallito';
  }
  try {
    const risposta = await fetchFn(indirizzo, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [INTESTAZIONE_SEGRETO]: segreto },
      body: JSON.stringify({ tipo: 'abbonamento-attivo', origine: 'primo abbonamento pagato', inviato_il: new Date().toISOString(), id: idAttivita }),
      signal: AbortSignal.timeout(ATTESA_MASSIMA_MS),
    });
    if (!risposta.ok) {
      logger.warn('[abbonamento-attivo] n8n ha risposto male: la pagella non è partita', { idAttivita, status: risposta.status });
      return 'fallito';
    }
    return 'inviato';
  } catch (errore) {
    logger.warn('[abbonamento-attivo] n8n non raggiunto: la pagella non è partita', { idAttivita, errore: String(errore) });
    return 'fallito';
  }
}

/** Il punto 1: l'indirizzo confermato della scheda nel profilo, solo se il profilo non ne ha già uno. */
export async function apriLaScheda(admin: SupabaseClient, idAttivita: string): Promise<'scritta' | 'niente' | 'fallita'> {
  const [scheda, profilo] = await Promise.all([
    admin.from('schede_clienti').select('scheda').eq('id_attivita', idAttivita).maybeSingle(),
    admin.from('profiles').select('store_address').eq('id', idAttivita).maybeSingle(),
  ]);
  if (scheda.error || profilo.error) {
    logger.warn('[abbonamento-attivo] scheda o profilo non letti: il profilo resta com’è', { idAttivita });
    return 'fallita';
  }
  const giaScritto = String((profilo.data as { store_address?: string | null } | null)?.store_address ?? '').trim();
  const dati = campiPerIlProfilo(leggiSchedaSalvata((scheda.data as { scheda?: unknown } | null)?.scheda));
  if (giaScritto || !dati.store_address) return 'niente';
  const { error } = await admin.from('profiles').update(dati).eq('id', idAttivita);
  if (error) {
    logger.warn('[abbonamento-attivo] indirizzo della scheda non scritto nel profilo', { idAttivita, message: error.message });
    return 'fallita';
  }
  return 'scritta';
}

/**
 * Tutto quello che succede al primo abbonamento pagato. Mai un errore verso chi chiama: il pagamento
 * è già registrato, e un pezzo mancato si rifà a mano (il 18 ha il suo webhook «Su richiesta»).
 */
export async function alPrimoAbbonamentoPagato(admin: SupabaseClient, idAttivita: string, fetchFn: typeof fetch = fetch): Promise<void> {
  try {
    const scheda = await apriLaScheda(admin, idAttivita);
    const avviso = await avvisaN8nAbbonamentoAttivo(idAttivita, fetchFn);
    logger.info('[abbonamento-attivo] scheda e pagella aperte', { idAttivita, scheda, avviso });
  } catch (errore) {
    logger.error('[abbonamento-attivo] scheda e pagella: qualcosa non è partito', { idAttivita, errore: String(errore) });
  }
}

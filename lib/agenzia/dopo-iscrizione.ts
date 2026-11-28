import type { SupabaseClient } from '@supabase/supabase-js';
import { descriviAttivita } from '@/lib/agenzia/tipi-attivita';
import { inviaNuovaAttivitaAlFlusso } from '@/lib/agenzia/nuovo-cliente-n8n';
import { analizzaSitoDopoLaRisposta } from '@/lib/agenzia/sito-pagespeed';
import type { NuovaAttivita } from '@/lib/agenzia/nuova-attivita';
import type { IndiziDelTitolare } from '@/lib/agenzia/indizi-del-titolare';

/**
 * QUELLO CHE PARTE DOPO L'ISCRIZIONE DI UN'ATTIVITÀ — 27/11/2026.
 *
 * Era dentro la porta del modulo 12 (app/api/agenzia/nuova-attivita). Adesso le porte sono due: il modulo 12
 * di n8n e il pulsante «Aggiungi attività» della pagina dell'agente (Nicola, 27/11: «secondo momento ma fatto
 * con un clic dalla stessa pagina»). Tutte e due fanno gli stessi passi, scritti una volta sola qui:
 *  · se l'attività ha un sito pubblico, Google PageSpeed lo misura dopo la risposta;
 *  · se l'attività è nuova, va al flusso 16 di n8n (ricerca, scheda chiusa fino all'abbonamento, analisi
 *    aperta, bozze dei tre abbonamenti). Una seconda pressione non la rimanda.
 * `dopo` lancia un lavoro dopo la risposta (`after` di Next); fuori da una richiesta, come nelle prove, lo lancia e basta.
 * `dalModulo12` dice al 16 se l'attività è già nella scheda Clienti dell'agenzia (il modulo 12 la scrive lui).
 * `indizi` (28/11/2026): il profilo Instagram e la scheda Google trovati dalla scheda del venditore, per il 16.
 */
export function avviaDopoLIscrizione(
  admin: SupabaseClient,
  fatto: { id: string; nuova: boolean; sito: string | null },
  a: NuovaAttivita,
  opzioni: { dalModulo12: boolean; dopo: (fn: () => Promise<void>) => void; indizi?: IndiziDelTitolare | null },
): void {
  if (fatto.sito) analizzaSitoDopoLaRisposta(admin, fatto.id, fatto.sito, opzioni.dopo);
  if (!fatto.nuova) return;
  const lavoro = async () => {
    await inviaNuovaAttivitaAlFlusso({
      idAttivita: fatto.id,
      nome: a.nome,
      tipo: a.tipo_attivita ?? null,
      tipoDescritto: a.tipo_attivita ? descriviAttivita(a.tipo_attivita, a.dettaglio) : null,
      indirizzo: a.indirizzo ?? null,
      citta: a.citta ?? null,
      descrizione: null,
      sito: fatto.sito ?? null,
      dalModulo12: opzioni.dalModulo12,
      indizi: opzioni.indizi ?? null,
    });
  };
  opzioni.dopo(lavoro);
}

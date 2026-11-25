import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { SchedaCliente } from './scheda-cliente';

/**
 * L'ANALISI SUBITO, LA SCHEDA E LA PAGELLA DOPO L'ABBONAMENTO — 25/11/2026.
 *
 * Nicola, 25/11 verso le 17:40: per ogni attività che si iscrive l'analisi parte subito, con tutte le
 * analisi a disposizione (ricerca sul web, social, scheda Google, sito), e serve a cucire i servizi su
 * misura. La scheda del cliente (indirizzo, telefono, orari, menu, link: quella che riempie la vetrina)
 * e la pagella sul marketplace (flusso 18, lib/agenzia/pagella.ts) arrivano SOLO dopo l'abbonamento.
 *
 * Dove stanno i dati nel frattempo (scelta di Nicola, 25/11): nel sito, chiusi. n8n manda la scheda
 * intera come prima (/api/agenzia/scheda-cliente); il sito la conserva, ma finché il negozio non è
 * abbonato tutto il sito la legge come se avesse solo l'analisi: niente campi, niente «da confermare».
 *
 * «Abbonato» (scelte dell'AD, 25/11):
 *  · ha pagato almeno una volta un abbonamento ai servizi: una riga in `abbonamenti_servizi` nasce solo
 *    da una cassa pagata (lib/stripe/webhook/servizi.ts). È lo stesso momento in cui finisce la demo,
 *    prima dell'approvazione dell'admin. Una disdetta dopo non richiude la scheda: è nata;
 *  · oppure era già online prima della modalità demo (`profiles.visibile_senza_abbonamento`,
 *    migrazione 709: Pane Quotidiano, i negozi di sistema). Per loro la pagella resta com'è.
 * Se la lettura non riesce la risposta è «chiusa»: meglio niente pagella che una mostrata a chi è in demo.
 */

/** Gli stati di Stripe in cui un abbonamento non è mai stato pagato. Tutti gli altri vengono da una cassa pagata. */
const MAI_PAGATO = new Set(['incomplete', 'incomplete_expired']);

export type DatiSblocco = {
  visibileSenzaAbbonamento: unknown;
  statiAbbonamenti: ReadonlyArray<unknown> | null | undefined;
};

/** Vero se la scheda del cliente e la pagella sono aperte per questo negozio. Solo decisioni, senza rete. */
export function schedaEPagellaAperte(d: DatiSblocco): boolean {
  if (d.visibileSenzaAbbonamento === true) return true;
  return (d.statiAbbonamenti ?? []).some((s) => typeof s === 'string' && s.trim() !== '' && !MAI_PAGATO.has(s));
}

/**
 * La scheda come la vede il sito: intera se il negozio è abbonato; altrimenti solo l'analisi (che vale
 * subito), senza i campi e senza «da confermare». `null` resta `null`.
 */
export function schedaPerIlSito(scheda: SchedaCliente | null | undefined, aperta: boolean): SchedaCliente | null {
  if (!scheda) return null;
  if (aperta) return scheda;
  return { ...scheda, campi: {}, da_confermare: [] };
}

/**
 * La scheda del link pubblico (solo campi confermati) con dentro l'analisi della scheda intera: dal 25/11
 * il preventivo si cuce sull'analisi anche nel link (Nicola). `null` se non c'è nessuna delle due.
 */
export function conLAnalisi(confermata: SchedaCliente | null, intera: SchedaCliente | null | undefined): SchedaCliente | null {
  if (!intera) return confermata;
  if (!intera.analisi) return confermata;
  return { ...(confermata ?? { ...intera, campi: {}, da_confermare: [] }), analisi: intera.analisi };
}

/**
 * Legge dal database se scheda e pagella sono aperte. Del profilo si chiede solo la colonna della
 * migrazione 709 (niente dati del titolare); se la colonna non c'è ancora vale «no» e decidono gli abbonamenti.
 */
export async function leggiSchedaEPagellaAperte(admin: SupabaseClient, idAttivita: string): Promise<boolean> {
  const [profilo, abbonamenti] = await Promise.all([
    admin.from('profiles').select('visibile_senza_abbonamento').eq('id', idAttivita).maybeSingle(),
    admin.from('abbonamenti_servizi').select('stato').eq('seller_id', idAttivita).limit(20),
  ]);
  const colonnaAssente = profilo.error && ['42703', 'PGRST204'].includes(String((profilo.error as { code?: string }).code));
  if (profilo.error && !colonnaAssente) {
    logger.warn('[scheda-dopo-abbonamento] profilo non letto: scheda e pagella restano chiuse', { idAttivita, message: profilo.error.message });
    return false;
  }
  const visibile = profilo.error ? false : (profilo.data as Record<string, unknown> | null)?.visibile_senza_abbonamento;
  if (visibile === true) return true;
  if (abbonamenti.error) {
    logger.warn('[scheda-dopo-abbonamento] abbonamenti non letti: scheda e pagella restano chiuse', { idAttivita, message: abbonamenti.error.message });
    return false;
  }
  return schedaEPagellaAperte({
    visibileSenzaAbbonamento: visibile,
    statiAbbonamenti: ((abbonamenti.data ?? []) as Array<{ stato?: unknown }>).map((r) => r.stato),
  });
}

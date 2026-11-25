import * as React from 'react';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import type { Preventivo } from '@/lib/agenzia/preventivo';
import { leggiPreventivo } from '@/lib/agenzia/leggi-preventivo';
import { leggiPreventivoColCodice, type PreventivoColCodice } from '@/lib/agenzia/preventivo-col-codice';
import { leggiSchedaSalvata, soloConfermati, type SchedaCliente } from '@/lib/agenzia/scheda-cliente';
import { leggiSchedaEPagellaAperte, schedaPerIlSito } from '@/lib/agenzia/scheda-dopo-abbonamento';

/**
 * QUELLO CHE SERVE AL PANNELLO DEMO DEL LINK COL CODICE — 25/11/2026.
 *
 * Il guscio (layout), la dashboard, le pagine dei servizi e la pagina dell'abbonamento leggono le
 * stesse cose: con `cache` di React la lettura si fa una volta sola per richiesta, anche se la
 * chiedono in quattro. Le regole sono quelle della pagina del preventivo del 24/11: solo i dati
 * confermati, niente dati personali, nessuna analisi interna (leggiPreventivo con `pubblico`).
 *
 * `cache` c'è nel React dei componenti del server (Next usa il 19); nelle prove, col React 18 del
 * progetto, non c'è e la lettura si fa e basta (come in lib/supabase/lettura-per-metadati.ts).
 */
type Memorizzatore = <F extends (...argomenti: never[]) => unknown>(f: F) => F;
const cacheDiReact = (React as unknown as { cache?: Memorizzatore }).cache;
const perRichiesta: Memorizzatore = (f) => (typeof cacheDiReact === 'function' ? cacheDiReact(f) : f);
export type DemoDalLink =
  | { tipo: 'non-trovato' }
  | { tipo: 'guasto'; messaggio: string }
  | { tipo: 'accettato'; pc: PreventivoColCodice }
  | { tipo: 'aperto'; pc: PreventivoColCodice; preventivo: Preventivo; scheda: SchedaCliente | null };

export const leggiDemoDalLink = perRichiesta(async (codice: string): Promise<DemoDalLink> => {
  const pc = await leggiPreventivoColCodice(codice).catch((e: unknown) => {
    logger.error('[preventivo-codice] pagina: lettura non riuscita', { errore: String(e) });
    return undefined;
  });
  if (pc === null || pc?.stato === 'chiuso') return { tipo: 'non-trovato' };
  if (!pc) return { tipo: 'guasto', messaggio: 'Non riesco a leggere il preventivo in questo momento. Riprova fra qualche minuto.' };
  if (pc.stato === 'accettato') return { tipo: 'accettato', pc };
  try {
    const admin = getAdminSupabase();
    const [l, s, aperta] = await Promise.all([
      // Pubblico: l'offerta su misura usa solo i dati confermati, senza le analisi (24/11).
      leggiPreventivo(pc.sellerId, undefined, { pubblico: true }),
      admin.from('schede_clienti').select('scheda').eq('id_attivita', pc.sellerId).maybeSingle(),
      // 25/11/2026 — La scheda del cliente vale solo dopo l'abbonamento (Nicola, mycity#330).
      leggiSchedaEPagellaAperte(admin, pc.sellerId),
    ]);
    // Il link non è la pagina del negozio: qui solo i dati confermati, niente «da confermare» (collaudo del 24/11).
    const scheda = s.error ? null : soloConfermati(schedaPerIlSito(leggiSchedaSalvata(s.data?.scheda), aperta));
    return { tipo: 'aperto', pc, preventivo: l.preventivo, scheda };
  } catch (e) {
    logger.error('[preventivo-codice] pagina: preventivo non preparato', { errore: String(e) });
    return { tipo: 'guasto', messaggio: 'Non riesco a preparare il preventivo in questo momento. Riprova fra qualche minuto.' };
  }
});

import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta } from '@/lib/api/corpo';
import { portaColSegreto } from '@/lib/api/porta-col-segreto';
import { logger } from '@/lib/logger';
import { pulisciFila, statiPerIlFlusso } from '@/lib/agenti/clienti';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * IL FLUSSO 16 E LA MAPPA DEI CLIENTI — 28/11/2026 (migrazione 999i).
 *
 * Il flusso n8n «16 · Attività da visitare» parla col sito da qui, con un segreto suo:
 * `N8N_CLIENTI_DA_VISITARE_SEGRETO`, nell'intestazione `x-mycity-segreto` (regole in lib/api/porta-col-segreto.ts:
 * senza segreto la porta resta chiusa, solo https, tetto di richieste prima di guardare il segreto).
 *  · GET  — gli stati che vivono nel sito (chi è già proposto, preso da un agente, visitato) e il conto per il
 *    messaggio del lunedì. Il flusso lo legge prima di «Metti in fila»: è l'unica fonte dello stato.
 *  · POST { giro, attivita: [...] } — tutta la fila del lunedì, con le posizioni, più le attività già proposte
 *    (anche loro con la posizione) e il dossier delle prime 30. Prenotazioni e stati non si toccano mai.
 *    `giro` è l'istante del giro (ISO): le attività che non c'erano si spengono (in_fila = false), mai si cancellano.
 * Se questa porta non risponde, il flusso va avanti lo stesso: Telegram e la tabella n8n non dipendono da qui.
 */

const TETTO = 2 * 1024 * 1024; // 650 attività stanno in circa 400 KB
const MASSIMO = 5000;

const porta = (req: Request) => portaColSegreto(req, { segreto: process.env.N8N_CLIENTI_DA_VISITARE_SEGRETO, nome: 'clienti-da-visitare', max: 30 });

export async function GET(req: Request): Promise<NextResponse> {
  const chiusa = await porta(req);
  if (chiusa) return chiusa;
  try {
    const data = await statiPerIlFlusso(getAdminSupabase());
    return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    logger.error('[clienti-da-visitare] lettura non riuscita', { errore: String(e) });
    return ApiErrors.unavailable('La mappa dei clienti non si legge: la migrazione 999i è applicata?');
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const chiusa = await porta(req);
  if (chiusa) return chiusa;
  let corpo: Record<string, unknown>;
  try {
    corpo = ((await jsonRichiesta(req, TETTO)) ?? {}) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge('Troppe attività in una volta (oltre 2 MB).');
    return ApiErrors.invalidRequest('Corpo non leggibile.');
  }
  const giro = typeof corpo.giro === 'string' && !Number.isNaN(Date.parse(corpo.giro)) ? new Date(corpo.giro).toISOString() : null;
  if (!giro) return ApiErrors.invalidRequest('Manca l’istante del giro (giro, in formato ISO).');
  // Un giro lontano da adesso spegnerebbe o terrebbe accese le righe sbagliate (collaudo del 28/11): ±1 giorno.
  if (Math.abs(Date.parse(giro) - Date.now()) > 24 * 3600 * 1000) return ApiErrors.invalidRequest('Il giro deve essere di oggi (giro = l’istante in cui il flusso è partito).');
  if (!Array.isArray(corpo.attivita)) return ApiErrors.invalidRequest('Manca l’elenco delle attività (attivita).');
  if (corpo.attivita.length > MASSIMO) return ApiErrors.payloadTooLarge(`Più di ${MASSIMO} attività in una volta.`);
  const { righe, scartate } = pulisciFila(corpo.attivita);
  // Un elenco vuoto spegnerebbe tutta la mappa: una fila vuota è un guasto del giro, non una città vuota.
  if (!righe.length) return ApiErrors.invalidRequest('Nessuna attività valida: la mappa resta com’era.');
  const { data, error } = await getAdminSupabase().rpc('ricevi_clienti_da_visitare', { p_righe: righe, p_giro: giro });
  if (error) {
    logger.error('[clienti-da-visitare] scrittura non riuscita', { errore: error.message });
    return ApiErrors.unavailable('La mappa dei clienti non si scrive: la migrazione 999i è applicata?');
  }
  return NextResponse.json({ ok: true, data: { ricevute: typeof data === 'number' ? data : righe.length, scartate } });
}

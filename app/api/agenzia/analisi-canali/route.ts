import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta } from '@/lib/api/corpo';
import { portaColSegreto } from '@/lib/api/porta-col-segreto';
import { logger } from '@/lib/logger';
import { AnalisiCanaliInArrivo, leggiAnalisiCanali } from '@/lib/agenzia/analisi';
import { canaliDaiSocial, haCanali } from '@/lib/agenzia/canali';
import { PREFISSO_DI_SISTEMA } from '@/lib/agenzia/bozza-sito-ad';

export const runtime = 'nodejs';

/**
 * L'ANALISI DEI CANALI FRA N8N E IL SITO — 24/11/2026.
 *
 * Nicola: nel servizio di analisi «ci deve essere anche l'analisi dei social, google, sito». Social e
 * scheda Google li legge n8n dai dati pubblici (solo fonti gratuite). Due strade, con lo stesso
 * segreto della scheda del cliente (`N8N_SCHEDA_CLIENTE_SEGRETO`: è sempre il sito che si fida di n8n):
 *  · GET  — l'elenco dei negozi che hanno salvato i canali dopo l'ultima analisi, coi canali da
 *    leggere (solo nomi dei profili e link pubblici: niente dati del titolare). Al massimo 50.
 *  · POST — l'analisi fatta (formato `AnalisiCanaliInArrivo`, lib/agenzia/analisi.ts): si salva in
 *    `analisi_negozi.canali` (migrazione 711). Rimandarla la sovrascrive.
 */

const TETTO_ANALISI = 64 * 1024;
const QUANTI_PER_VOLTA = 50;

const porta = (req: Request) => portaColSegreto(req, { segreto: process.env.N8N_SCHEDA_CLIENTE_SEGRETO, nome: 'analisi-canali' });

type RigaRichiesta = { id_attivita: string; canali_richiesti_il: string | null; canali_il: string | null };

export async function GET(req: Request): Promise<NextResponse> {
  const chiusa = await porta(req);
  if (chiusa) return chiusa;

  const admin = getAdminSupabase();
  const righe = await admin
    .from('analisi_negozi')
    .select('id_attivita, canali_richiesti_il, canali_il')
    .not('canali_richiesti_il', 'is', null)
    .order('canali_richiesti_il', { ascending: true })
    .limit(500);
  if (righe.error) {
    logger.error('[analisi-canali] richieste non lette', { message: righe.error.message });
    return ApiErrors.unavailable('Riprova fra poco.');
  }
  // Da fare: chiesta e mai fatta, o chiesta di nuovo dopo l'ultima (i canali sono cambiati).
  const daFare = ((righe.data ?? []) as RigaRichiesta[])
    .filter((r) => r.canali_richiesti_il && (!r.canali_il || new Date(r.canali_richiesti_il) > new Date(r.canali_il)))
    .slice(0, QUANTI_PER_VOLTA);
  if (daFare.length === 0) return NextResponse.json({ ok: true, richieste: [] }, { headers: { 'Cache-Control': 'no-store' } });

  const profili = await admin
    .from('profiles')
    .select('id, role, store_name, business_type, store_address, store_customization')
    .in('id', daFare.map((r) => r.id_attivita));
  if (profili.error) {
    logger.error('[analisi-canali] negozi non letti', { message: profili.error.message });
    return ApiErrors.unavailable('Riprova fra poco.');
  }
  const perId = new Map(((profili.data ?? []) as Array<Record<string, unknown>>).map((p) => [String(p.id), p]));
  const richieste = daFare.flatMap((r) => {
    const p = perId.get(r.id_attivita);
    if (!p || p.role !== 'seller') return [];
    const canali = canaliDaiSocial((p.store_customization as { socials?: Record<string, string> } | null)?.socials);
    if (!haCanali(canali)) return [];
    const pieni = Object.fromEntries(Object.entries(canali).filter(([, v]) => (v ?? '').trim()));
    return [{
      id_attivita: r.id_attivita,
      nome: (p.store_name as string | null) ?? null,
      tipo: (p.business_type as string | null) ?? null,
      indirizzo: (p.store_address as string | null) ?? null,
      richiesta_il: r.canali_richiesti_il,
      canali: pieni,
    }];
  });
  return NextResponse.json({ ok: true, richieste }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request): Promise<NextResponse> {
  const chiusa = await porta(req);
  if (chiusa) return chiusa;

  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO_ANALISI);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Corpo non leggibile');
  }
  const esito = AnalisiCanaliInArrivo.safeParse(corpo);
  if (!esito.success) {
    const primo = esito.error.issues[0];
    return ApiErrors.invalidRequest(`Analisi non valida: ${primo?.path.join('.') || 'corpo'} — ${primo?.message ?? ''}`.trim());
  }
  const id = esito.data.id_attivita.toLowerCase();
  if (id.startsWith(PREFISSO_DI_SISTEMA)) return ApiErrors.invalidRequest('I negozi di sistema non hanno un’analisi.');

  const admin = getAdminSupabase();
  const profilo = await admin.from('profiles').select('id, role').eq('id', id).maybeSingle();
  if (profilo.error) {
    logger.error('[analisi-canali] profilo non letto', { id, message: profilo.error.message });
    return ApiErrors.unavailable('Riprova fra poco.');
  }
  if ((profilo.data as { role?: string } | null)?.role !== 'seller') return ApiErrors.notFound('Nessuna attività con questo id.');

  // Si salva già ripulita (le frasi con un prezzo tolte), con l'id scritto come nel database.
  const pulita = leggiAnalisiCanali({ ...esito.data, id_attivita: id });
  const adesso = new Date().toISOString();
  const { error } = await admin
    .from('analisi_negozi')
    .upsert({ id_attivita: id, canali: pulita, canali_il: adesso, aggiornata_il: adesso }, { onConflict: 'id_attivita' });
  if (error) {
    logger.error('[analisi-canali] analisi non salvata', { id, message: error.message });
    return ApiErrors.unavailable('Non sono riuscito a salvare l’analisi. Riprova fra poco.');
  }
  logger.info('[analisi-canali] analisi salvata', { id, canali: Object.keys(esito.data.canali).length });
  return NextResponse.json({ ok: true }, { status: 200 });
}

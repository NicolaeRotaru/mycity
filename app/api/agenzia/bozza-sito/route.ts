import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta } from '@/lib/api/corpo';
import { portaColSegreto } from '@/lib/api/porta-col-segreto';
import { logger } from '@/lib/logger';
import { BozzaSitoInArrivo, PREFISSO_DI_SISTEMA } from '@/lib/agenzia/bozza-sito-ad';
import { negoziCheAspettanoLaBozza } from '@/lib/agenzia/bozze-in-attesa';

export const runtime = 'nodejs';

/**
 * LA BOZZA DEL SITO FRA L'AD E IL SITO — 24/11/2026.
 *
 * Nicola: la bozza del sito fatta con l'IA la scrive «l'AD in un giro», sul suo piano: il sito non
 * chiama nessuna IA. Due strade, chiuse dal segreto `AD_BOZZA_SITO_SEGRETO` (solo https):
 *  · GET  — i negozi che aspettano la bozza, coi dati pubblici del locale per scriverla (nome, tipo,
 *    indirizzo, descrizione, prodotti senza prezzi, la scheda di n8n). Niente dati del titolare.
 *  · POST — la bozza scritta (formato `BozzaSitoInArrivo`, lib/agenzia/bozza-sito-ad.ts): si salva in
 *    `bozze_sito` (migrazione 711) e la pagina «Sito web» del negozio la mostra al posto di quella
 *    fatta coi dati. Rimandarla la sovrascrive.
 */

const TETTO_BOZZA = 32 * 1024;

const porta = (req: Request) => portaColSegreto(req, { segreto: process.env.AD_BOZZA_SITO_SEGRETO, nome: 'bozza-sito' });

export async function GET(req: Request): Promise<NextResponse> {
  const chiusa = await porta(req);
  if (chiusa) return chiusa;
  try {
    const negozi = await negoziCheAspettanoLaBozza({ conIDati: true });
    return NextResponse.json({ ok: true, negozi }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (errore) {
    logger.error('[bozza-sito] elenco non letto', { errore: String(errore) });
    return ApiErrors.unavailable('Riprova fra poco.');
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const chiusa = await porta(req);
  if (chiusa) return chiusa;

  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO_BOZZA);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Corpo non leggibile');
  }
  const esito = BozzaSitoInArrivo.safeParse(corpo);
  if (!esito.success) {
    const primo = esito.error.issues[0];
    return ApiErrors.invalidRequest(`Bozza non valida: ${primo?.path.join('.') || 'corpo'} — ${primo?.message ?? ''}`.trim());
  }
  const id = esito.data.id_attivita.toLowerCase();
  if (id.startsWith(PREFISSO_DI_SISTEMA)) return ApiErrors.invalidRequest('I negozi di sistema non hanno una bozza del sito.');

  const admin = getAdminSupabase();
  const profilo = await admin.from('profiles').select('id, role').eq('id', id).maybeSingle();
  if (profilo.error) {
    logger.error('[bozza-sito] profilo non letto', { id, message: profilo.error.message });
    return ApiErrors.unavailable('Riprova fra poco.');
  }
  if ((profilo.data as { role?: string } | null)?.role !== 'seller') return ApiErrors.notFound('Nessuna attività con questo id.');

  const adesso = new Date().toISOString();
  const { error } = await admin.from('bozze_sito').upsert(
    { id_attivita: id, bozza: { ...esito.data, id_attivita: id }, origine: (esito.data.origine ?? 'ad-mycity').slice(0, 40), ricevuta_il: adesso },
    { onConflict: 'id_attivita' },
  );
  if (error) {
    logger.error('[bozza-sito] bozza non salvata', { id, message: error.message });
    return ApiErrors.unavailable('Non sono riuscito a salvare la bozza. Riprova fra poco.');
  }
  logger.info('[bozza-sito] bozza salvata', { id });
  return NextResponse.json({ ok: true }, { status: 200 });
}

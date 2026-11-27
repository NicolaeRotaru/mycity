import { NextResponse, after } from 'next/server';
import { avviaDopoLIscrizione } from '@/lib/agenzia/dopo-iscrizione';
import { getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta } from '@/lib/api/corpo';
import { portaColSegreto } from '@/lib/api/porta-col-segreto';
import { logger } from '@/lib/logger';
import { NuovaAttivitaInArrivo, iscriviAttivita } from '@/lib/agenzia/nuova-attivita';

export const runtime = 'nodejs';
// 25/11/2026 — Dopo la risposta può partire l'analisi del sito con Google PageSpeed (fino a 55 secondi).
export const maxDuration = 60;

/**
 * IL MODULO 12 DI N8N ISCRIVE UN CLIENTE NUOVO IN MYCITY — 25/11/2026.
 *
 * Nicola compila il modulo 12 («nuovo cliente»), n8n fa POST qui e il negozio nasce come Ora del Gusto:
 * senza accesso, fuori vetrina, col suo link col codice in Admin → Preventivi col link. Nessuna email,
 * nessun messaggio al titolare: il link lo manda Nicola. Rimandare lo stesso nome e città non crea un
 * secondo negozio.
 *
 * La porta è quella in cui il sito si fida di n8n, quindi usa lo stesso segreto della scheda
 * (`N8N_SCHEDA_CLIENTE_SEGRETO`, intestazione `x-mycity-segreto`). Senza segreto resta chiusa (503).
 */

const TETTO = 8 * 1024;

/** Un lavoro dopo la risposta. Fuori da una richiesta (le prove) `after` non c'è: si lancia e basta. */
const dopoLaRisposta = (fn: () => Promise<void>) => {
  try {
    after(fn);
  } catch {
    void fn();
  }
};

const porta = (req: Request) =>
  portaColSegreto(req, { segreto: process.env.N8N_SCHEDA_CLIENTE_SEGRETO, nome: 'nuova-attivita', max: 20 });

export async function POST(req: Request): Promise<NextResponse> {
  const chiusa = await porta(req);
  if (chiusa) return chiusa;

  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Corpo non leggibile');
  }
  const esito = NuovaAttivitaInArrivo.safeParse(corpo);
  if (!esito.success) {
    const primo = esito.error.issues[0];
    return ApiErrors.invalidRequest(`Attività non valida: ${primo?.path.join('.') || 'corpo'} — ${primo?.message ?? ''}`.trim());
  }

  const admin = getAdminSupabase();
  const fatto = await iscriviAttivita(admin, esito.data);
  if (!fatto.ok) {
    if (fatto.motivo === 'gia-con-accesso') {
      return NextResponse.json({ ok: false, error: { code: 'GIA_ATTIVA', message: 'Questa attività ha già accettato il preventivo: il modulo non la riscrive.' } }, { status: 409 });
    }
    logger.error('[nuova-attivita] iscrizione non riuscita', { dettaglio: fatto.dettaglio });
    return ApiErrors.unavailable('Non sono riuscito a iscrivere l’attività. Riprova fra poco.');
  }
  logger.info('[nuova-attivita] attività iscritta', { id: fatto.id, nuova: fatto.nuova });
  // 25/11/2026 — Nicola: per ogni attività che si iscrive l'analisi parte subito, da tutte e due le porte.
  // Chi nasce dal modulo 12 va anche al flusso 16, come chi si iscrive da solo su /sell: il 16 fa la
  // ricerca, manda al sito la scheda (che resta chiusa fino all'abbonamento, con l'analisi aperta) e
  // prepara le bozze dei tre abbonamenti (flusso 19). Solo per un negozio nuovo, dopo la risposta:
  // il 20 non aspetta. Spento finché Nicola non collega il 16 (lib/agenzia/nuovo-cliente-n8n.ts).
  // 27/11/2026 — I passi stanno in lib/agenzia/dopo-iscrizione.ts: li usa anche il pulsante dell'agente.
  avviaDopoLIscrizione(admin, fatto, esito.data, { dalModulo12: true, dopo: dopoLaRisposta });
  return NextResponse.json({ ok: true, id_attivita: fatto.id, nuova: fatto.nuova }, { status: fatto.nuova ? 201 : 200 });
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors, apiError } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { chiudiConsegnaDaAmministratore, MOTIVO_MINIMO_CHIUSURA } from '@/lib/cassa/registra-incasso';

export const runtime = 'nodejs';

const Body = z.object({
  orderId: z.string().uuid(),
  /** I contanti dichiarati a voce dal fattorino; `null` se li aveva già dichiarati lui. */
  incassatoCents: z.number().int().min(0).max(10_000_000).nullable(),
  /** Perché la chiude l'amministratore: resta nel registro (audit_logs, migrazione 360). */
  motivo: z.string().trim().min(MOTIVO_MINIMO_CHIUSURA).max(300),
});

/**
 * 28/11/2026 (onda 2, R06-004) — IL PULSANTE CHE MANCAVA PER CHIUDERE LA CONSEGNA.
 *
 * Il caso: il fattorino consegna in contanti, intasca i soldi e non riapre più l'app. L'ordine resta
 * «in consegna» per sempre, la rimessa della sera non lo vede e il negozio non viene pagato.
 * La funzione del database (`admin_chiudi_consegna`, migrazione 360) e la strada del sito
 * (`chiudiConsegnaDaAmministratore`, lib/cassa/registra-incasso.ts) c'erano già dal 26/11, ma
 * nessuna rotta né pulsante le chiamava: l'allarme «rider fermo» portava alla pagina dell'ordine, e
 * lì c'era solo «Annulla» (che su una consegna in contanti già pagata alla porta non è la cosa giusta).
 *
 * Qui la si chiama con la SESSIONE dell'amministratore (`supaUtente`): dentro la funzione is_admin()
 * e il registro guardano auth.uid(). Il client di servizio serve solo a riallineare la giornata di
 * cassa del fattorino. Le regole (solo contanti a domicilio in OUT_FOR_DELIVERY, motivo, importo
 * fuori misura) le decide il database nella stessa transazione della scrittura.
 */
export const POST = withAdminAuthRateLimit(
  { name: 'admin-chiudi-consegna', max: 30, windowMs: 60 * 60_000 },
  async ({ req, supaUtente }): Promise<NextResponse> => {
    let body;
    try {
      body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
    } catch (e) {
      if (e instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(e.message);
      return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
    }

    let servizio: ReturnType<typeof getAdminSupabase>;
    try {
      servizio = getAdminSupabase();
    } catch (e) {
      return ApiErrors.unavailable(e instanceof Error ? e.message : 'config error');
    }

    const esito = await chiudiConsegnaDaAmministratore(
      supaUtente as unknown as Parameters<typeof chiudiConsegnaDaAmministratore>[0],
      servizio,
      { ordineId: body.orderId, incassatoCents: body.incassatoCents, motivo: body.motivo },
    );
    if (!esito.ok) return apiError(esito.stato, esito.messaggio, esito.motivo);
    return NextResponse.json({ ok: true, incassoRegistrato: esito.incassoRegistrato }, { status: 200 });
  },
);

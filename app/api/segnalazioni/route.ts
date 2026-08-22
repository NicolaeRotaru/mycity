import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Segnalare un contenuto illecito.
 *
 * 22/8/2026 — QUESTO CANALE NON ESISTEVA. Sul sito non c'era nessun modo di
 * dirci che un prodotto è contraffatto, pericoloso o illecito: nessun pulsante,
 * nessuna rotta, nessun registro. Il regolamento europeo sui servizi digitali
 * lo chiede a ogni piattaforma che ospita contenuti di terzi — e per un
 * marketplace non è burocrazia: è il modo in cui un titolare di marchio, o un
 * cliente che vede una cosa pericolosa, ce lo può dire prima che la compri
 * qualcun altro.
 *
 * Si può segnalare anche senza account: una segnalazione che pretende la
 * registrazione è una segnalazione che non arriva. Chi lascia un recapito ha
 * diritto a un esito motivato.
 */
const Corpo = z.object({
  tipo: z.enum(['prodotto', 'negozio', 'recensione', 'messaggio']),
  oggettoId: z.string().uuid(),
  motivo: z.enum([
    'contraffatto', 'illecito', 'pericoloso', 'ingannevole',
    'proprieta_intellettuale', 'odio_o_molestie', 'altro',
  ]),
  dettaglio: z.string().max(2000).optional(),
  emailContatto: z.string().email().max(320).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  {
    // Il canale deve restare aperto a chi non ha un account, quindi il freno
    // e' sull'indirizzo di rete: dieci segnalazioni all'ora bastano a chiunque
    // in buona fede e fermano chi vuole intasarlo.
    const ip = getClientIp(req);
    const rl = await rateLimitAsync({ key: `segnalazioni:${ip}`, max: 10, windowMs: 60 * 60_000 });
    if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);
  }
  {
    let corpo;
    try {
      corpo = Corpo.parse(await jsonRichiesta(req, TETTO_JSON));
    } catch (e) {
      return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
    }

    // Chi è loggato viene riconosciuto, ma non è obbligatorio.
    let autoreId: string | null = null;
    try {
      const supa = await getServerSupabase();
      autoreId = (await supa.auth.getUser()).data.user?.id ?? null;
    } catch {
      autoreId = null;
    }

    const admin = getAdminSupabase();
    const { data, error } = await admin
      .from('segnalazioni')
      .insert({
        tipo: corpo.tipo,
        oggetto_id: corpo.oggettoId,
        motivo: corpo.motivo,
        dettaglio: corpo.dettaglio ?? null,
        segnalante_id: autoreId,
        email_contatto: corpo.emailContatto ?? null,
      })
      .select('id')
      .single();

    if (error) {
      logger.error('[segnalazioni] non registrata', { message: error.message });
      return ApiErrors.internal('Segnalazione non registrata: riprova');
    }

    // Gli amministratori la devono vedere, non scoprirla.
    try {
      const { data: capi } = await admin.from('profiles').select('id').eq('role', 'admin');
      const righe = (capi ?? []).map((c) => ({
        user_id: c.id as string,
        title: '🚩 Nuova segnalazione',
        body: `Segnalato un ${corpo.tipo} per «${corpo.motivo}». Va esaminata e chiusa con un esito motivato.`,
        link: '/admin/segnalazioni',
        category: 'moderation',
      }));
      if (righe.length > 0) await admin.from('notifications').insert(righe);
    } catch (e) {
      logger.warn('[segnalazioni] avviso agli amministratori non partito', { e });
    }

    return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
  }
}

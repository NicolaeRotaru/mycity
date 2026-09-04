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

    /**
     * Gli amministratori la devono vedere, non scoprirla.
     *
     * 3/9/2026 — L'AVVISO NON PARTIVA, E NESSUNO LO SAPEVA.
     *
     * Qui la riga di avviso nasceva con categoria «moderation», e il database
     * ammette solo `order`, `promo`, `group`, `newsletter`, `system`
     * (migrazione 115): la scrittura veniva rifiutata. Peggio: il campo
     * `error` che il client Supabase restituisce non veniva letto — e quel
     * client non solleva eccezioni, quindi il `try/catch` qui attorno non
     * scattava mai. La rotta rispondeva «ricevuto» e la segnalazione restava
     * in tabella finche' qualcuno non apriva a mano /admin/segnalazioni.
     * Nessuna campanella, nessuna riga nei registri. E' il canale che il
     * regolamento europeo sui servizi digitali obbliga ad avere e a lavorare
     * in tempi ragionevoli.
     *
     * La categoria giusta e' `system`: sono gli avvisi di servizio, gli unici
     * che l'amministratore non puo' spegnere dalle preferenze — e una
     * segnalazione di prodotto pericoloso non deve poter essere silenziata.
     * L'esito dell'inserimento adesso si legge sempre.
     */
    try {
      const { data: capi } = await admin.from('profiles').select('id').eq('role', 'admin');
      const righe = (capi ?? []).map((c) => ({
        user_id: c.id as string,
        title: '🚩 Nuova segnalazione',
        body: `Segnalato un ${corpo.tipo} per «${corpo.motivo}». Va esaminata e chiusa con un esito motivato.`,
        link: '/admin/segnalazioni',
        category: 'system',
      }));
      if (righe.length > 0) {
        const { error: erroreAvviso } = await admin.from('notifications').insert(righe);
        if (erroreAvviso) {
          logger.error(new Error(`[segnalazioni] avviso agli amministratori non scritto: ${erroreAvviso.message}`), {
            context: 'segnalazioni',
            segnalazione: data.id,
            destinatari: righe.length,
          });
        }
      } else {
        logger.error(new Error('[segnalazioni] nessun amministratore a cui mandare l avviso'), {
          context: 'segnalazioni',
          segnalazione: data.id,
        });
      }
    } catch (e) {
      logger.warn('[segnalazioni] avviso agli amministratori non partito', { e });
    }

    return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
  }
}

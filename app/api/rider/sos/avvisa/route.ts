import { withAuthRateLimit } from '@/lib/api/middleware';
import { apiSuccess, ApiErrors } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { iscrizioniPerUtenti, isPushConfigured, sendPushToUser } from '@/lib/push/send';
import { logger } from '@/lib/logger';

/**
 * R01-004 (12/11/2026) — L'SOS DEL FATTORINO ARRIVA SUBITO SUL TELEFONO DEGLI AMMINISTRATORI.
 *
 * Prima l'SOS scriveva solo una riga in `rider_sos_events`: il trigger della 037 crea una
 * notifica nel pannello per ogni admin, e il push partiva dal lavoro periodico send-push, ogni
 * cinque minuti. Cinque minuti di silenzio per un'emergenza per strada.
 *
 * Il telefono del fattorino, dopo aver scritto l'evento (e dopo aver gia' aperto il 112),
 * chiama questa rotta. Qui si rilegge l'ultimo SOS aperto di QUEL fattorino (mai un id passato
 * dal telefono: non si fa suonare il telefono degli admin per un evento di un altro) e si manda
 * subito un push ad alta urgenza a ogni amministratore. Il push periodico resta com'e': se
 * questo non parte, la notifica nel pannello e il giro dei cinque minuti ci sono ancora.
 */

/** Un SOS piu' vecchio di cosi' non e' «quello appena premuto». */
const FINESTRA_SOS_MS = 10 * 60_000;

export const POST = withAuthRateLimit(
  { name: 'rider-sos-avvisa', max: 5, windowMs: 60_000 },
  async ({ user, profile }) => {
    if (profile.role !== 'rider') return ApiErrors.forbidden('Solo i fattorini possono mandare un SOS');
    if (!isPushConfigured()) {
      logger.error('[sos] push non configurato: l\'SOS resta solo nel pannello degli amministratori', { rider: user.id });
      return ApiErrors.unavailable('Le notifiche push non sono configurate');
    }

    let admin: ReturnType<typeof getAdminSupabase>;
    try {
      admin = getAdminSupabase();
    } catch (e) {
      logger.error('[sos] client di servizio non disponibile', { errore: e instanceof Error ? e.message : 'errore' });
      return ApiErrors.unavailable('Servizio non configurato');
    }

    const da = new Date(Date.now() - FINESTRA_SOS_MS).toISOString();
    const { data: sos, error: errSos } = await admin
      .from('rider_sos_events')
      .select('id, order_id, triggered_at')
      .eq('rider_id', user.id)
      .is('resolved_at', null)
      .gte('triggered_at', da)
      .order('triggered_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (errSos) {
      logger.error('[sos] lettura dell\'SOS non riuscita', { message: errSos.message });
      return ApiErrors.internal('SOS non letto');
    }
    if (!sos) return ApiErrors.notFound('Nessun SOS aperto negli ultimi minuti');

    const { data: admins, error: errAdmin } = await admin.from('profiles').select('id').eq('role', 'admin');
    if (errAdmin) {
      logger.error('[sos] elenco degli amministratori non letto', { message: errAdmin.message });
      return ApiErrors.internal('Amministratori non letti');
    }
    const ids = (admins ?? []).map((a) => (a as { id: string }).id);
    if (ids.length === 0) {
      logger.error('[sos] nessun amministratore a cui mandare l\'SOS', { sos: sos.id });
      return apiSuccess({ amministratori: 0, consegnati: 0 });
    }

    let iscrizioni: Awaited<ReturnType<typeof iscrizioniPerUtenti>>;
    try {
      iscrizioni = await iscrizioniPerUtenti(admin, ids);
    } catch (e) {
      logger.error('[sos] iscrizioni push non lette', { errore: e instanceof Error ? e.message : 'errore' });
      return ApiErrors.internal('Iscrizioni push non lette');
    }

    const consegna = sos.order_id ? ` (consegna #${String(sos.order_id).slice(0, 8)})` : '';
    let consegnati = 0;
    for (const id of ids) {
      try {
        const esito = await sendPushToUser(
          admin,
          id,
          {
            title: '🆘 SOS RIDER',
            body: `Un fattorino ha attivato il SOS${consegna}. Apri la consolle e chiamalo.`,
            url: '/admin/sos',
            tag: `sos-${sos.id}`,
            renotify: true,
          },
          iscrizioni.get(id) ?? [],
          { TTL: 600, urgency: 'high' },
        );
        consegnati += esito.delivered;
      } catch (e) {
        logger.error('[sos] push a un amministratore non partito', { errore: e instanceof Error ? e.message : 'errore' });
      }
    }
    if (consegnati === 0) logger.error('[sos] nessun telefono di amministratore raggiunto', { sos: sos.id });
    return apiSuccess({ amministratori: ids.length, consegnati });
  },
);

import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import type { AuditAction } from '@/lib/audit-azioni';

/**
 * Helper server-side per scrivere voci nell'audit log.
 *
 * Usato dalle API route admin per registrare azioni sensibili: chi ha
 * approvato chi, chi ha rimborsato cosa, chi ha sospeso. Tutti i campi
 * sono opzionali tranne action e actorId.
 *
 * Best-effort: non blocca la richiesta se il log fallisce, ma il guasto si
 * vede — vedi `annotaGuasto` qui sotto.
 */
// L'elenco delle azioni e le loro etichette stanno in `lib/audit-azioni.ts`:
// la pagina del registro (nel browser) le legge da li', senza tirarsi dietro
// il client di servizio di questo file.
export type { AuditAction } from '@/lib/audit-azioni';

export type AuditEntry = {
  actorId: string;
  action: AuditAction;
  targetTable?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
};

/**
 * 30/8/2026 (R023) — LA SCRITTURA RIFIUTATA NON LANCIA: LA DEVI GUARDARE.
 *
 * Le due insert qui sotto non alzavano mai un'eccezione quando il database
 * rifiutava la riga: il client Supabase risponde `{ data: null, error }` e
 * basta. Quindi il `try/catch` non scattava, il messaggio di guasto non usciva,
 * e il registro delle azioni amministrative poteva restare vuoto per giorni
 * senza che nessuno lo sapesse — finche' non serviva sapere chi aveva sospeso
 * un account, e non c'era piu' scritto da nessuna parte.
 *
 * E il racconto va nel logger, non in `console.error`: in produzione la console
 * si perde, il logger arriva a Sentry.
 */
function annotaGuasto(dove: string, entry: AuditEntry, errore: { message?: string; code?: string } | null): void {
  if (!errore) return;
  logger.error(new Error(`[audit] scrittura fallita su ${dove}: ${errore.message ?? 'motivo non dato'}`), {
    action: entry.action,
    actorId: entry.actorId,
    targetTable: entry.targetTable ?? null,
    targetId: entry.targetId ?? null,
    code: errore.code ?? null,
  });
}

/**
 * 13/11/2026 (R16-014) — CHI HA FATTO L'AZIONE, NON «ADMIN» PER TUTTI.
 *
 * Lo specchio in `activity_events` scriveva sempre «Azione admin», ma `writeAudit` lo chiamano
 * anche fattorini e negozi (documenti caricati, verifica inviata, prodotti caricati dal file):
 * nel pannello sembravano azioni dello staff. Il ruolo si legge dal profilo di chi agisce. Se la
 * lettura non riesce non si indovina: la riga dice «Azione», senza dire di chi. Nessun guasto
 * annotato: il registro vero (`audit_logs`) e' gia' scritto, questa e' solo l'etichetta.
 */
async function ruoloDi(supa: ReturnType<typeof getAdminSupabase>, actorId: string): Promise<string | null> {
  try {
    const { data, error } = await supa.from('profiles').select('role').eq('id', actorId).maybeSingle();
    const ruolo = (data as { role?: unknown } | null)?.role;
    return !error && typeof ruolo === 'string' ? ruolo : null;
  } catch {
    return null;
  }
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const supa = getAdminSupabase();
    const [{ error: erroreRegistro }, ruolo] = await Promise.all([
      supa.from('audit_logs').insert({
        actor_id: entry.actorId,
        action: entry.action,
        target_table: entry.targetTable ?? null,
        target_id: entry.targetId ?? null,
        metadata: entry.metadata ?? null,
        ip: entry.ip ?? null,
        user_agent: entry.userAgent ?? null,
      }),
      ruoloDi(supa, entry.actorId),
    ]);
    annotaGuasto('audit_logs', entry, erroreRegistro);
    const chi = ruolo === 'admin' ? 'admin' : ruolo ? 'utente' : null;
    // Mirror nel firehose di sorveglianza così l'admin vede TUTTO in un posto
    // solo (categoria "moderation"). Best-effort: non blocca la richiesta.
    const { error: erroreFirehose } = await supa.from('activity_events').insert({
      category: 'moderation',
      event_type: entry.action,
      action: chi,
      summary: `${chi === 'admin' ? 'Azione admin' : chi === 'utente' ? 'Azione utente' : 'Azione'}: ${entry.action}`,
      actor_id: entry.actorId,
      target_table: entry.targetTable ?? null,
      target_id: entry.targetId ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.userAgent ?? null,
      metadata: entry.metadata ?? null,
    });
    annotaGuasto('activity_events', entry, erroreFirehose);
  } catch (err) {
    logger.error(err, { context: 'audit.write', action: entry.action, actorId: entry.actorId });
  }
}

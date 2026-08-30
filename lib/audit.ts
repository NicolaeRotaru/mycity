import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

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
export type AuditAction =
  | 'user.approve'
  | 'user.reject'
  | 'user.suspend'
  | 'user.reactivate'
  | 'user.delete'
  | 'product.create'
  | 'product.update'
  | 'product.hide'
  | 'product.show'
  | 'order.refund'
  | 'order.force_cancel'
  | 'dispute.resolve_buyer'
  | 'dispute.resolve_seller'
  | 'dispute.reject'
  | 'coupon.create'
  | 'coupon.delete'
  | 'kyc.approve'
  | 'kyc.reject';

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

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const supa = getAdminSupabase();
    const { error: erroreRegistro } = await supa.from('audit_logs').insert({
      actor_id: entry.actorId,
      action: entry.action,
      target_table: entry.targetTable ?? null,
      target_id: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.userAgent ?? null,
    });
    annotaGuasto('audit_logs', entry, erroreRegistro);
    // Mirror nel firehose di sorveglianza così l'admin vede TUTTO in un posto
    // solo (categoria "moderation"). Best-effort: non blocca la richiesta.
    const { error: erroreFirehose } = await supa.from('activity_events').insert({
      category: 'moderation',
      event_type: entry.action,
      action: 'admin',
      summary: `Azione admin: ${entry.action}`,
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

import { getAdminSupabase } from '@/lib/supabase/server';

/**
 * Helper server-side per scrivere voci nell'audit log.
 *
 * Usato dalle API route admin per registrare azioni sensibili: chi ha
 * approvato chi, chi ha rimborsato cosa, chi ha sospeso. Tutti i campi
 * sono opzionali tranne action e actorId.
 *
 * Best-effort: non blocca la richiesta se il log fallisce, ma logga in console.
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

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const supa = getAdminSupabase();
    await supa.from('audit_logs').insert({
      actor_id: entry.actorId,
      action: entry.action,
      target_table: entry.targetTable ?? null,
      target_id: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.userAgent ?? null,
    });
    // Mirror nel firehose di sorveglianza così l'admin vede TUTTO in un posto
    // solo (categoria "moderation"). Best-effort: non blocca la richiesta.
    await supa.from('activity_events').insert({
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
  } catch (err) {
    console.error('[audit] write failed:', err);
  }
}

'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';
import { AdminPageTitle } from '@/components/admin/AdminUI';

type AuditRow = {
  id: string;
  actor_id: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
  actor: { full_name: string | null; email: string | null } | null;
};

const ACTION_LABEL: Record<string, string> = {
  'user.approve':       'Utente approvato',
  'user.reject':        'Utente rifiutato',
  'user.suspend':       'Utente sospeso',
  'user.reactivate':    'Utente riattivato',
  'user.delete':        'Utente eliminato',
  'product.hide':       'Prodotto nascosto',
  'product.show':       'Prodotto reso visibile',
  'order.refund':       'Ordine rimborsato',
  'order.force_cancel': 'Ordine cancellato (forzato)',
  'dispute.resolve_buyer':  'Reclamo risolto a favore del buyer',
  'dispute.resolve_seller': 'Reclamo risolto a favore del seller',
  'dispute.reject':     'Reclamo rifiutato',
  'coupon.create':      'Coupon creato',
  'coupon.delete':      'Coupon eliminato',
  'kyc.approve':        'KYC approvato',
  'kyc.reject':         'KYC rifiutato',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AuditLogPage() {
  // NOTE (design/backend-gated): la card "anti-frode price-change" del kit di
  // design richiede dati di price-history per i prodotti. Questa pagina carica
  // SOLO la tabella audit_logs e non dispone di quella sorgente; non viene
  // fabbricata alcuna timeline prezzi qui. La card resta sbloccabile lato
  // backend quando price-history sarà esposto (es. tabella product_price_history
  // o evento audit dedicato).
  const [filterAction, setFilterAction] = useState<string>('');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.audit(filterAction),
    queryFn: async (): Promise<AuditRow[]> => {
      let q = supabase
        .from('audit_logs')
        .select(`
          id, actor_id, action, target_table, target_id, metadata, ip, created_at,
          actor:profiles!audit_logs_actor_id_fkey ( full_name, email )
        `)
        .order('created_at', { ascending: false })
        .limit(200);
      if (filterAction) q = q.eq('action', filterAction);
      const { data } = await q;
      return (data ?? []) as unknown as AuditRow[];
    },
  });

  return (
    <div className="space-y-6">
      <AdminPageTitle
        eyebrow="Sistema"
        title="Audit log"
        sub="Registro immutabile delle azioni amministrative. Per compliance e audit."
      />

      <div className="bg-white border-2 border-cream-300 rounded-xl p-4">
        <label className="block text-xs font-semibold text-ink-700 mb-1">Filtra per azione</label>
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
        >
          <option value="">Tutte le azioni</option>
          {Object.entries(ACTION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="h-16 rounded-xl skeleton" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border-2 border-cream-300 rounded-xl p-12 text-center">
          <Clock size={36} className="mx-auto text-ink-300 mb-3" />
          <p className="text-ink-600 font-medium">Nessuna voce nel log</p>
          <p className="text-sm text-ink-400 mt-1">Le azioni admin compariranno qui man mano.</p>
        </div>
      ) : (
        <div className="bg-white border-2 border-cream-300 rounded-xl divide-y divide-cream-200 overflow-hidden">
          {rows.map((r) => (
            <div key={r.id} className="px-4 py-3 hover:bg-cream-50 transition-colors">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-ink-900">{ACTION_LABEL[r.action] ?? r.action}</p>
                    <span className="rounded bg-cream-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-600">{r.action}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">
                    da <strong>{r.actor?.full_name ?? r.actor?.email ?? 'sistema'}</strong>
                    {r.target_table && r.target_id && (
                      <> · <span className="font-mono">{r.target_table}/{r.target_id.slice(0, 8)}…</span></>
                    )}
                  </p>
                </div>
                <span className="text-xs text-ink-400 shrink-0">{formatDateTime(r.created_at)}</span>
              </div>
              {r.metadata && Object.keys(r.metadata).length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-ink-500 cursor-pointer hover:text-ink-700">Dettagli</summary>
                  <pre className="mt-1 text-xs bg-cream-50 border border-cream-200 rounded p-2 overflow-x-auto">
                    {JSON.stringify(r.metadata, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

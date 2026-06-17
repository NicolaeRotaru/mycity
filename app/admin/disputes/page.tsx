'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, X, Clock, ArrowLeft, Sparkles, Search, CheckCircle2, PartyPopper, type LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

type Dispute = {
  id: string;
  order_id: string;
  opener_id: string;
  reason: string;
  description: string;
  status: 'open' | 'under_review' | 'resolved_buyer' | 'resolved_seller' | 'rejected';
  resolution_notes: string | null;
  refund_cents: number | null;
  created_at: string;
  opener: { full_name: string | null; email: string | null } | null;
  against: { store_name: string | null; full_name: string | null } | null;
};

const STATUS_META: Record<Dispute['status'], { label: string; color: string; icon: LucideIcon }> = {
  open:              { label: 'Aperto',                          color: 'accent',    icon: Sparkles },
  under_review:      { label: 'In valutazione',                  color: 'primary',   icon: Search },
  resolved_buyer:    { label: 'Risolto a favore del buyer',      color: 'olive',     icon: CheckCircle2 },
  resolved_seller:   { label: 'Risolto a favore del venditore',  color: 'olive',     icon: CheckCircle2 },
  rejected:          { label: 'Rifiutato',                       color: 'secondary', icon: X },
};

const REASON_LABEL: Record<string, string> = {
  not_received:        'Non ricevuto',
  damaged:             'Danneggiato',
  wrong_item:          'Prodotto sbagliato',
  not_as_described:    'Non come descritto',
  seller_unreachable:  'Venditore non risponde',
  other:               'Altro',
};

export default function AdminDisputesPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Dispute['status'] | 'all'>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [refundEur, setRefundEur] = useState('');

  const { data: disputes = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.disputes2(filter),
    queryFn: async (): Promise<Dispute[]> => {
      let q = supabase
        .from('disputes')
        .select(`
          id, order_id, opener_id, reason, description, status, resolution_notes,
          refund_cents, created_at,
          opener:profiles!disputes_opener_id_fkey ( full_name, email ),
          against:profiles!disputes_against_id_fkey ( store_name, full_name )
        `)
        .order('created_at', { ascending: false })
        .limit(100);
      if (filter !== 'all') q = q.eq('status', filter);
      const { data } = await q;
      return (data ?? []) as unknown as Dispute[];
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, status, notes, refund }: {
      id: string; status: Dispute['status']; notes: string; refund?: number;
    }) => {
      // Passa dalla route admin server-side: emette il rimborso Stripe reale
      // (refundOrder) ed evita il fallimento RLS dell'update client-side.
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/disputes/${id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status, notes, refundCents: refund }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? data?.error ?? 'Errore risoluzione reclamo');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.disputes2() });
      setOpenId(null);
      setResolution('');
      setRefundEur('');
      toast.success('Reclamo aggiornato');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const detail = disputes.find((d) => d.id === openId);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-ink-500 hover:text-ink-800">← Dashboard admin</Link>
        <h1 className="text-3xl font-serif font-bold mt-2 text-ink-900 flex items-center gap-2">
          <AlertCircle size={26} className="text-secondary-600" />
          Reclami
        </h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['open', 'under_review', 'resolved_buyer', 'resolved_seller', 'rejected', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
              filter === f
                ? 'bg-primary-700 text-white'
                : 'bg-white border border-cream-300 text-ink-700 hover:border-primary-300'
            }`}
          >
            {f === 'all' ? 'Tutti' : STATUS_META[f].label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-32 rounded-xl skeleton" />)}</div>
      ) : disputes.length === 0 ? (
        <div className="bg-white border border-cream-300 rounded-2xl p-12 text-center">
          <PartyPopper size={40} strokeWidth={2} className="mx-auto text-olive-500 mb-2" aria-hidden />
          <p className="text-ink-600 font-medium">Nessun reclamo in questo stato</p>
        </div>
      ) : (
        <div className="space-y-3">
          {disputes.map((d) => {
            const meta = STATUS_META[d.status];
            const StatusIcon = meta.icon;
            return (
              <div key={d.id} className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                        meta.color === 'accent' ? 'bg-accent-100 text-accent-800' :
                        meta.color === 'primary' ? 'bg-primary-100 text-primary-800' :
                        meta.color === 'olive' ? 'bg-olive-100 text-olive-800' :
                        'bg-secondary-100 text-secondary-800'
                      }`}>
                        <StatusIcon size={13} strokeWidth={2.2} aria-hidden /> {meta.label}
                      </span>
                      <span className="text-xs text-ink-500">
                        Reclamo · {REASON_LABEL[d.reason] ?? d.reason}
                      </span>
                    </div>
                    <p className="text-sm text-ink-900 mt-2">
                      <strong>{d.opener?.full_name ?? d.opener?.email ?? 'Cliente'}</strong>
                      {' vs '}
                      <strong>{d.against?.store_name ?? d.against?.full_name ?? 'Venditore'}</strong>
                    </p>
                    <p className="text-xs text-ink-400 mt-0.5">
                      Ordine #{d.order_id.slice(0, 8)} · {new Date(d.created_at).toLocaleDateString('it-IT')}
                    </p>
                  </div>
                </div>

                <p className="text-sm text-ink-700 bg-cream-50 rounded-lg p-3 whitespace-pre-line">
                  {d.description}
                </p>

                {d.resolution_notes && (
                  <div className="mt-3 p-3 bg-olive-50 rounded-lg border border-olive-200">
                    <p className="text-xs font-bold text-olive-800 uppercase tracking-wider mb-1">Risoluzione</p>
                    <p className="text-sm text-olive-900">{d.resolution_notes}</p>
                    {d.refund_cents && (
                      <p className="text-sm font-bold text-olive-900 mt-1">Rimborso: {formatPrice(d.refund_cents / 100)}</p>
                    )}
                  </div>
                )}

                {(d.status === 'open' || d.status === 'under_review') && (
                  <div className="mt-3 flex gap-2">
                    <Button
                      onClick={() => { setOpenId(d.id); setResolution(''); setRefundEur(''); }}
                      size="sm"
                    >Decidi</Button>
                    <Link
                      href={`/messages`}
                      className="text-xs font-semibold text-primary-700 hover:underline py-2"
                    >
                      Contatta le parti
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal decisione */}
      <Modal
        open={!!openId && !!detail}
        onClose={() => setOpenId(null)}
        title="Risolvi reclamo"
      >
        {openId && detail && (
          <div className="space-y-4">

            <textarea
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              rows={4}
              placeholder="Spiega la decisione presa (verrà mostrato alle parti)…"
              className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />

            <div>
              <label className="block text-xs font-semibold text-ink-700 mb-1">Rimborso (€) - opzionale</label>
              <input
                type="number"
                step="0.01"
                value={refundEur}
                onChange={(e) => setRefundEur(e.target.value)}
                placeholder="0.00"
                className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
              <button
                onClick={() => decide.mutate({
                  id: openId,
                  status: 'resolved_buyer',
                  notes: resolution.trim(),
                  refund: refundEur ? Math.round(Number(refundEur) * 100) : undefined,
                })}
                disabled={decide.isPending || resolution.trim().length < 10}
                className="bg-olive-600 hover:bg-olive-700 disabled:opacity-50 text-white text-sm font-semibold px-3 py-2 rounded-lg flex items-center justify-center gap-1"
              >
                <Check size={14} /> A favore buyer
              </button>
              <Button
                onClick={() => decide.mutate({
                  id: openId,
                  status: 'resolved_seller',
                  notes: resolution.trim(),
                })}
                loading={decide.isPending}
                disabled={resolution.trim().length < 10}
                size="sm"
                icon={Check}
              >A favore seller</Button>
              <button
                onClick={() => decide.mutate({
                  id: openId,
                  status: 'rejected',
                  notes: resolution.trim(),
                })}
                disabled={decide.isPending || resolution.trim().length < 10}
                className="bg-secondary-600 hover:bg-secondary-700 disabled:opacity-50 text-white text-sm font-semibold px-3 py-2 rounded-lg flex items-center justify-center gap-1"
              >
                <X size={14} /> Rifiuta
              </button>
            </div>
            <p className="text-xs text-ink-400 text-center">Min 10 caratteri di motivazione richiesti.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RotateCcw, Check, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice, formatDate } from '@/lib/format';
import { friendlyError } from '@/lib/errors';

export type ReturnRow = {
  id: string;
  status: string;
  reason: string | null;
  notes: string | null;
  photo_urls: string[] | null;
  refund_amount_cents: number | null;
  decision_notes: string | null;
  created_at: string;
};

const REASON_LABEL: Record<string, string> = {
  DAMAGED: 'Prodotto danneggiato',
  WRONG_ITEM: 'Articolo sbagliato',
  NOT_AS_DESCRIBED: 'Non come descritto',
  CHANGED_MIND: 'Ripensamento',
  LATE: 'Consegna in ritardo',
  OTHER: 'Altro motivo',
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  REQUESTED:    { label: 'In attesa di decisione', cls: 'bg-accent-100 text-accent-800' },
  APPROVED:     { label: 'Approvato',               cls: 'bg-olive-100 text-olive-700' },
  REJECTED:     { label: 'Rifiutato',               cls: 'bg-secondary-100 text-secondary-700' },
  SHIPPED_BACK: { label: 'In rientro',              cls: 'bg-primary-100 text-primary-700' },
  RECEIVED:     { label: 'Reso ricevuto',           cls: 'bg-primary-100 text-primary-700' },
  REFUNDED:     { label: 'Rimborsato',              cls: 'bg-olive-100 text-olive-700' },
  CANCELED:     { label: 'Annullato',               cls: 'bg-cream-200 text-ink-600' },
};

type Props = {
  ret: ReturnRow;
  orderTotal: number;
  onDecided: () => void;
};

/**
 * Card richiesta di reso lato venditore. Finché lo stato è REQUESTED mostra
 * le azioni Approva / Rifiuta (con nota e importo rimborso opzionali) che
 * chiamano POST /api/returns/[id]/decide. Negli altri stati è in sola lettura.
 */
export default function ReturnRequestCard({ ret, orderTotal, onDecided }: Props) {
  const [amount, setAmount] = useState(orderTotal ? orderTotal.toFixed(2) : '');
  const [notes, setNotes] = useState('');
  const meta = STATUS_META[ret.status] ?? { label: ret.status, cls: 'bg-cream-200 text-ink-600' };
  const isPending = ret.status === 'REQUESTED';

  const decide = useMutation({
    mutationFn: async (decision: 'APPROVED' | 'REJECTED') => {
      const { data: { session } } = await supabase.auth.getSession();
      const body: { decision: string; notes?: string; refundAmountCents?: number } = { decision };
      if (notes.trim()) body.notes = notes.trim();
      if (decision === 'APPROVED') {
        const cents = Math.round(parseFloat(amount.replace(',', '.')) * 100);
        if (Number.isFinite(cents) && cents > 0) body.refundAmountCents = cents;
      }
      const res = await fetch(`/api/returns/${ret.id}/decide`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? j.message ?? 'Operazione non riuscita');
      }
      return res.json();
    },
    onSuccess: (_data, decision) => {
      toast.success(decision === 'APPROVED' ? 'Reso approvato' : 'Reso rifiutato');
      onDecided();
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  return (
    <div className="bg-white border-2 border-accent-300 rounded-2xl overflow-hidden shadow-warm">
      <div className="flex items-center justify-between gap-3 px-5 py-3 bg-accent-50 border-b border-accent-200">
        <h2 className="font-semibold text-ink-900 flex items-center gap-2">
          <RotateCcw size={18} className="text-accent-700" aria-hidden />
          Richiesta di reso
        </h2>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${meta.cls}`}>
          {meta.label}
        </span>
      </div>

      <div className="px-5 py-4 space-y-3 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <p><span className="text-ink-500">Motivo:</span> <span className="font-medium text-ink-900">{REASON_LABEL[ret.reason ?? ''] ?? ret.reason ?? '—'}</span></p>
          <p><span className="text-ink-500">Richiesto il:</span> <span className="font-medium text-ink-900">{formatDate(ret.created_at)}</span></p>
        </div>

        {ret.notes && (
          <p className="text-ink-700 bg-cream-50 border border-cream-200 rounded-lg px-3 py-2">
            <span className="text-ink-500">Nota del cliente: </span>{ret.notes}
          </p>
        )}

        {Array.isArray(ret.photo_urls) && ret.photo_urls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {ret.photo_urls.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="relative w-20 h-20 rounded-lg overflow-hidden bg-cream-100 border border-cream-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Foto reso ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        )}

        {isPending ? (
          <div className="pt-2 border-t border-cream-200 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="block text-ink-600 mb-1">Importo rimborso (€)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="es. 41.40"
                  className="w-32 border border-cream-300 rounded-lg px-3 py-2 focus:outline-none focus:border-primary-400"
                />
              </label>
              <p className="text-xs text-ink-400 mb-2.5">
                Lascia il totale per rimborsare tutto subito, oppure svuota per decidere il rimborso quando ricevi il pacco.
              </p>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Nota per il cliente (opzionale)"
              className="w-full border border-cream-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-400"
            />
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => decide.mutate('APPROVED')}
                disabled={decide.isPending}
                className="inline-flex items-center gap-1.5 bg-olive-600 hover:bg-olive-700 text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
              >
                <Check size={16} strokeWidth={2.4} /> Approva reso
              </button>
              <button
                onClick={() => decide.mutate('REJECTED')}
                disabled={decide.isPending}
                className="inline-flex items-center gap-1.5 bg-white border border-secondary-300 text-secondary-700 hover:bg-secondary-50 px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
              >
                <X size={16} strokeWidth={2.4} /> Rifiuta
              </button>
            </div>
          </div>
        ) : (
          <div className="pt-2 border-t border-cream-200 space-y-1 text-ink-700">
            {ret.refund_amount_cents ? (
              <p><span className="text-ink-500">Rimborso:</span> <span className="font-semibold">{formatPrice(ret.refund_amount_cents / 100)}</span></p>
            ) : null}
            {ret.decision_notes && (
              <p><span className="text-ink-500">Nota:</span> {ret.decision_notes}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

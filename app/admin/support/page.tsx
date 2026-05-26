'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Inbox, Mail, CheckCircle2, AlertOctagon, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

type Message = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: 'new' | 'in_progress' | 'resolved' | 'spam';
  admin_notes: string | null;
  handled_at: string | null;
  created_at: string;
};

const STATUS_META: Record<Message['status'], { label: string; color: string; icon: any }> = {
  new:         { label: 'Nuovo',         color: 'accent',    icon: Mail },
  in_progress: { label: 'In gestione',   color: 'primary',   icon: Clock },
  resolved:    { label: 'Risolto',       color: 'olive',     icon: CheckCircle2 },
  spam:        { label: 'Spam',          color: 'secondary', icon: AlertOctagon },
};

export default function AdminSupportPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Message['status'] | 'all'>('new');
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const { data: messages = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.support(filter),
    queryFn: async (): Promise<Message[]> => {
      let q = supabase
        .from('contact_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (filter !== 'all') q = q.eq('status', filter);
      const { data } = await q;
      return (data ?? []) as Message[];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, adminNotes }: { id: string; status: Message['status']; adminNotes?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('contact_messages')
        .update({
          status,
          admin_notes: adminNotes ?? null,
          handled_by: user?.id ?? null,
          handled_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'support'] });
      setOpenId(null);
      setNotes('');
      toast.success('Stato aggiornato');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const detail = messages.find((m) => m.id === openId);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-ink-500 hover:text-ink-800">← Dashboard admin</Link>
        <h1 className="text-3xl font-serif font-bold mt-2 text-ink-900 flex items-center gap-2">
          <Inbox size={26} className="text-primary-600" />
          Customer support inbox
        </h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['new', 'in_progress', 'resolved', 'spam', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f as any)}
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
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-28 rounded-xl skeleton" />)}</div>
      ) : messages.length === 0 ? (
        <div className="bg-white border border-cream-300 rounded-2xl p-12 text-center">
          <p className="text-4xl mb-2">📬</p>
          <p className="text-ink-600 font-medium">Nessun messaggio in questo stato</p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => {
            const meta = STATUS_META[m.status];
            const Icon = meta.icon;
            return (
              <div key={m.id} className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                        meta.color === 'accent' ? 'bg-accent-100 text-accent-800' :
                        meta.color === 'primary' ? 'bg-primary-100 text-primary-800' :
                        meta.color === 'olive' ? 'bg-olive-100 text-olive-800' :
                        'bg-secondary-100 text-secondary-800'
                      }`}>
                        <Icon size={12} /> {meta.label}
                      </span>
                      <span className="text-xs text-ink-500">{m.subject}</span>
                    </div>
                    <p className="font-semibold text-ink-900">{m.name}</p>
                    <a href={`mailto:${m.email}`} className="text-xs text-primary-700 hover:underline">{m.email}</a>
                  </div>
                  <span className="text-xs text-ink-400 shrink-0">{new Date(m.created_at).toLocaleString('it-IT')}</span>
                </div>

                <p className="mt-3 text-sm text-ink-700 bg-cream-50 rounded-lg p-3 whitespace-pre-line line-clamp-3">
                  {m.message}
                </p>

                {m.admin_notes && (
                  <div className="mt-2 p-2 bg-olive-50 rounded text-xs text-olive-800">
                    <strong>Note:</strong> {m.admin_notes}
                  </div>
                )}

                <div className="mt-3 flex gap-2 flex-wrap">
                  <button
                    onClick={() => { setOpenId(m.id); setNotes(m.admin_notes ?? ''); }}
                    className="bg-primary-700 hover:bg-primary-800 text-white text-xs font-semibold px-3 py-2 rounded-lg"
                  >
                    Gestisci
                  </button>
                  <a
                    href={`mailto:${m.email}?subject=Re: ${encodeURIComponent(m.subject)}`}
                    className="text-xs font-semibold text-primary-700 hover:underline py-2"
                  >
                    Rispondi via email
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!openId && !!detail}
        onClose={() => setOpenId(null)}
        title="Aggiorna stato"
      >
        {openId && detail && (
          <div className="space-y-4">

            <div className="bg-cream-50 rounded-lg p-3 text-sm text-ink-700 max-h-40 overflow-y-auto">
              <p className="font-semibold mb-1">{detail.name} — {detail.subject}</p>
              <p className="whitespace-pre-line">{detail.message}</p>
            </div>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Note interne (opzionale)…"
              className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />

            <div className="grid grid-cols-2 gap-2">
              {(['in_progress', 'resolved', 'spam', 'new'] as const).map((s) => {
                const meta = STATUS_META[s];
                return (
                  <button
                    key={s}
                    onClick={() => updateStatus.mutate({ id: openId, status: s, adminNotes: notes.trim() || undefined })}
                    disabled={updateStatus.isPending}
                    className={`text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 ${
                      meta.color === 'olive' ? 'bg-olive-600 hover:bg-olive-700 text-white' :
                      meta.color === 'primary' ? 'bg-primary-700 hover:bg-primary-800 text-white' :
                      meta.color === 'secondary' ? 'bg-secondary-600 hover:bg-secondary-700 text-white' :
                      'bg-accent-500 hover:bg-accent-600 text-ink-900'
                    }`}
                  >
                    → {meta.label}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setOpenId(null)} className="w-full text-xs text-ink-500 hover:text-ink-800 mt-2">
              Annulla
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}

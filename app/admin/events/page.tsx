'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus, Pencil, Trash2, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { confirmDialog } from '@/components/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ImageUrlField } from '@/components/ImageUrlField';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

/**
 * Admin: gestione Eventi MyCity.
 *
 * Esperti consultati:
 * - Growth PM: "Cron tone: 1 evento/settimana minimo. Admin tool deve essere
 *   veloce (< 2 min per evento). Niente form a 20 campi."
 * - Operations Manager: "Status: scheduled → live → ended. Transition automatica
 *   via 'live now' bottone manuale = controllo totale."
 * - Content Designer: "Titolo + descrizione brevi. La copy fa l'evento."
 * - Trust & Safety: "Conferma su cancel."
 */

type EventRow = {
  id: string;
  title: string;
  description: string;
  cover_image_url: string | null;
  starts_at: string;
  ends_at: string;
  discount_percent: number | null;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  cta_label: string;
  cta_url: string | null;
  sponsor_seller_id: string | null;
};

function emptyForm(): Partial<EventRow> {
  const now = new Date();
  const start = new Date(now.getTime() + 3 * 86400_000);
  start.setHours(18, 0, 0, 0);
  const end = new Date(start.getTime() + 4 * 3600_000);
  return {
    title: '',
    description: '',
    cover_image_url: '',
    starts_at: start.toISOString().slice(0, 16),
    ends_at: end.toISOString().slice(0, 16),
    discount_percent: null,
    cta_label: 'Partecipa',
    cta_url: '',
    status: 'scheduled',
  };
}

export default function AdminEventsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<EventRow> | null>(null);

  const { data: events = [] } = useQuery({
    queryKey: queryKeys.admin.events,
    queryFn: async (): Promise<EventRow[]> => {
      const { data } = await supabase
        .from('marketplace_events')
        .select('*')
        .order('starts_at', { ascending: false });
      return (data ?? []) as EventRow[];
    },
  });

  const save = useMutation({
    mutationFn: async (form: Partial<EventRow>) => {
      const payload = {
        title: form.title?.trim(),
        description: form.description?.trim(),
        cover_image_url: form.cover_image_url?.trim() || null,
        starts_at: new Date(form.starts_at as string).toISOString(),
        ends_at: new Date(form.ends_at as string).toISOString(),
        discount_percent: form.discount_percent ?? null,
        cta_label: form.cta_label?.trim() || 'Partecipa',
        cta_url: form.cta_url?.trim() || null,
        status: form.status ?? 'scheduled',
      };
      if (!payload.title || !payload.description) throw new Error('Titolo e descrizione sono obbligatori');
      if (new Date(payload.ends_at) <= new Date(payload.starts_at)) throw new Error('Fine deve essere dopo inizio');

      if (form.id) {
        const { error } = await supabase.from('marketplace_events').update(payload).eq('id', form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('marketplace_events').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Evento salvato');
      setEditing(null);
      qc.invalidateQueries({ queryKey: queryKeys.admin.events });
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const changeStatus = useMutation({
    mutationFn: async (vars: { id: string; status: EventRow['status'] }) => {
      const { error } = await supabase.from('marketplace_events').update({ status: vars.status }).eq('id', vars.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Stato aggiornato');
      qc.invalidateQueries({ queryKey: queryKeys.admin.events });
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('marketplace_events').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Evento eliminato');
      qc.invalidateQueries({ queryKey: queryKeys.admin.events });
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const STATUS_BADGE: Record<EventRow['status'], string> = {
    scheduled: 'bg-primary-100 text-primary-900',
    live: 'bg-rose-100 text-rose-800',
    ended: 'bg-cream-100 text-ink-600',
    cancelled: 'bg-accent-100 text-accent-800',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-ink-900 flex items-center gap-2">
          <CalendarDays size={22} className="text-secondary-600" strokeWidth={2.2} />
          Eventi MyCity
        </h1>
        <Button onClick={() => setEditing(emptyForm())} size="sm" icon={Plus}>Nuovo evento</Button>
      </div>

      {/* DESKTOP: tabella */}
      <div className="hidden md:block bg-white border border-cream-300 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream-50 text-ink-600">
            <tr>
              <th className="text-left px-4 py-2">Titolo</th>
              <th className="text-left px-4 py-2">Inizio</th>
              <th className="text-left px-4 py-2">Fine</th>
              <th className="text-left px-4 py-2">Stato</th>
              <th className="text-right px-4 py-2">Azioni</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-100">
            {events.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-500">Nessun evento.</td></tr>
            ) : events.map((ev) => (
              <tr key={ev.id} className="hover:bg-cream-50">
                <td className="px-4 py-3 font-semibold text-ink-900">{ev.title}</td>
                <td className="px-4 py-3 text-ink-600">{new Date(ev.starts_at).toLocaleString('it-IT')}</td>
                <td className="px-4 py-3 text-ink-600">{new Date(ev.ends_at).toLocaleString('it-IT')}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_BADGE[ev.status]}`}>{ev.status}</span>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  {ev.status === 'scheduled' && (
                    <button onClick={() => changeStatus.mutate({ id: ev.id, status: 'live' })} className="text-rose-700 hover:text-rose-800 text-xs font-semibold inline-flex items-center gap-1">
                      <Play size={12} strokeWidth={2.4} /> Vai live
                    </button>
                  )}
                  {ev.status === 'live' && (
                    <button onClick={() => changeStatus.mutate({ id: ev.id, status: 'ended' })} className="text-ink-700 hover:text-ink-900 text-xs font-semibold inline-flex items-center gap-1">
                      <Pause size={12} strokeWidth={2.4} /> Termina
                    </button>
                  )}
                  <button onClick={() => setEditing({
                    ...ev,
                    starts_at: ev.starts_at.slice(0, 16),
                    ends_at: ev.ends_at.slice(0, 16),
                  })} className="text-primary-700 hover:text-primary-800 text-xs font-semibold inline-flex items-center gap-1">
                    <Pencil size={12} strokeWidth={2.4} /> Modifica
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: 'Eliminare evento?',
                        message: 'I partecipanti RSVP verranno notificati.',
                        confirmLabel: 'Elimina',
                        danger: true,
                      });
                      if (ok) del.mutate(ev.id);
                    }}
                    className="text-rose-700 hover:text-rose-800 text-xs font-semibold inline-flex items-center gap-1"
                  >
                    <Trash2 size={12} strokeWidth={2.4} /> Elimina
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MOBILE: card con azioni sempre visibili */}
      <div className="md:hidden space-y-3">
        {events.length === 0 ? (
          <div className="bg-white border border-cream-300 rounded-xl p-8 text-center text-ink-500">Nessun evento.</div>
        ) : events.map((ev) => (
          <div key={ev.id} className="bg-white border border-cream-300 rounded-xl p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-ink-900">{ev.title}</h3>
              <span className={`shrink-0 inline-block px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_BADGE[ev.status]}`}>{ev.status}</span>
            </div>
            <p className="text-xs text-ink-500 mt-1">
              {new Date(ev.starts_at).toLocaleString('it-IT')} → {new Date(ev.ends_at).toLocaleString('it-IT')}
            </p>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-cream-100 flex-wrap">
              {ev.status === 'scheduled' && (
                <button onClick={() => changeStatus.mutate({ id: ev.id, status: 'live' })} className="flex-1 min-w-[90px] inline-flex items-center justify-center gap-1 bg-rose-50 text-rose-700 font-semibold py-2 rounded-lg text-sm">
                  <Play size={14} strokeWidth={2.4} /> Vai live
                </button>
              )}
              {ev.status === 'live' && (
                <button onClick={() => changeStatus.mutate({ id: ev.id, status: 'ended' })} className="flex-1 min-w-[90px] inline-flex items-center justify-center gap-1 bg-cream-100 text-ink-700 font-semibold py-2 rounded-lg text-sm">
                  <Pause size={14} strokeWidth={2.4} /> Termina
                </button>
              )}
              <button onClick={() => setEditing({
                ...ev,
                starts_at: ev.starts_at.slice(0, 16),
                ends_at: ev.ends_at.slice(0, 16),
              })} className="flex-1 min-w-[90px] inline-flex items-center justify-center gap-1 bg-primary-50 text-primary-700 font-semibold py-2 rounded-lg text-sm">
                <Pencil size={14} strokeWidth={2.4} /> Modifica
              </button>
              <button
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: 'Eliminare evento?',
                    message: 'I partecipanti RSVP verranno notificati.',
                    confirmLabel: 'Elimina',
                    danger: true,
                  });
                  if (ok) del.mutate(ev.id);
                }}
                aria-label="Elimina"
                className="px-3 py-2 text-rose-700 bg-rose-50 rounded-lg"
              >
                <Trash2 size={16} strokeWidth={2.4} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Modifica evento' : 'Nuovo evento'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Annulla</Button>
            <Button type="submit" form="event-form" loading={save.isPending}>Salva</Button>
          </>
        }
      >
        {editing && (
          <form
            id="event-form"
            onSubmit={(e) => { e.preventDefault(); save.mutate(editing); }}
            className="space-y-4"
          >
              <div>
                <label className="block text-sm font-semibold mb-1">Titolo</label>
                <input value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Descrizione</label>
                <textarea value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm resize-none" required />
              </div>
              <ImageUrlField
                label="Immagine cover"
                value={editing.cover_image_url ?? ''}
                onChange={(url) => setEditing({ ...editing, cover_image_url: url })}
                pathPrefix="events"
                hint="Consigliato 16:9. Carica un file o incolla un URL."
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1">Inizio</label>
                  <input value={editing.starts_at as string ?? ''} onChange={(e) => setEditing({ ...editing, starts_at: e.target.value })} type="datetime-local" className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm" required />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Fine</label>
                  <input value={editing.ends_at as string ?? ''} onChange={(e) => setEditing({ ...editing, ends_at: e.target.value })} type="datetime-local" className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1">Sconto % (opz.)</label>
                  <input value={editing.discount_percent ?? ''} onChange={(e) => setEditing({ ...editing, discount_percent: e.target.value ? Number(e.target.value) : null })} type="number" min={0} max={80} className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">CTA label</label>
                  <input value={editing.cta_label ?? 'Partecipa'} onChange={(e) => setEditing({ ...editing, cta_label: e.target.value })} className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">CTA URL (link evento)</label>
                <input value={editing.cta_url ?? ''} onChange={(e) => setEditing({ ...editing, cta_url: e.target.value })} type="url" className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm" placeholder="/search?event=…" />
              </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Coins, Plus, Pause, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { confirmDialog } from '@/components/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

/**
 * Admin: Cashback Campaigns.
 *
 * Esperti consultati:
 * - Growth PM: "Cashback condizionato = leva di reattivazione. Bonus 100 punti
 *   se torna entro 24h dal carrello abbandonato."
 * - Behavioral Scientist: "Reward immediato (loyalty points) + time-bounded
 *   (valid_hours) crea urgenza."
 * - Finance Manager: "Max budget = bonus_points * unique_users. Cap a campagna."
 * - Trust & Safety: "1 redemption/utente via UNIQUE PK."
 */

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  trigger_event: 'first_order' | 'return_after_inactive' | 'cart_abandoned' | 'new_signup' | 'category_purchase';
  bonus_points: number;
  valid_hours: number;
  min_order_cents: number;
  starts_at: string;
  ends_at: string;
  status: 'active' | 'paused' | 'ended';
};

function emptyForm(): Partial<Campaign> {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 86400_000);
  return {
    name: '',
    description: '',
    trigger_event: 'cart_abandoned',
    bonus_points: 100,
    valid_hours: 24,
    min_order_cents: 0,
    starts_at: now.toISOString().slice(0, 16),
    ends_at: end.toISOString().slice(0, 16),
    status: 'active',
  };
}

const TRIGGER_LABEL: Record<Campaign['trigger_event'], string> = {
  first_order: 'Primo ordine',
  return_after_inactive: 'Ritorno dopo inattività',
  cart_abandoned: 'Carrello abbandonato',
  new_signup: 'Nuova iscrizione',
  category_purchase: 'Acquisto in categoria',
};

export default function AdminCashbackPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Campaign> | null>(null);

  const { data: campaigns = [] } = useQuery({
    queryKey: ['admin-cashback'],
    queryFn: async (): Promise<Campaign[]> => {
      const { data } = await supabase
        .from('cashback_campaigns')
        .select('*')
        .order('created_at', { ascending: false });
      return (data ?? []) as Campaign[];
    },
  });

  const save = useMutation({
    mutationFn: async (f: Partial<Campaign>) => {
      if (!f.name?.trim()) throw new Error('Nome obbligatorio');
      const payload = {
        name: f.name.trim(),
        description: f.description?.trim() || null,
        trigger_event: f.trigger_event,
        bonus_points: Number(f.bonus_points) || 100,
        valid_hours: Number(f.valid_hours) || 24,
        min_order_cents: Number(f.min_order_cents) || 0,
        starts_at: new Date(f.starts_at as string).toISOString(),
        ends_at: new Date(f.ends_at as string).toISOString(),
        status: f.status ?? 'active',
      };
      if (f.id) {
        const { error } = await supabase.from('cashback_campaigns').update(payload).eq('id', f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('cashback_campaigns').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Campagna salvata');
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['admin-cashback'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const setStatus = useMutation({
    mutationFn: async (vars: { id: string; status: Campaign['status'] }) => {
      const { error } = await supabase.from('cashback_campaigns').update({ status: vars.status }).eq('id', vars.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-cashback'] });
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cashback_campaigns').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Eliminata');
      qc.invalidateQueries({ queryKey: ['admin-cashback'] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-ink-900 flex items-center gap-2">
          <Coins size={22} className="text-accent-500" strokeWidth={2.2} />
          Campagne Cashback
        </h1>
        <button
          onClick={() => setEditing(emptyForm())}
          className="inline-flex items-center gap-1.5 bg-primary-700 hover:bg-primary-800 text-white px-4 py-2 rounded-lg font-bold text-sm"
        >
          <Plus size={16} strokeWidth={2.4} /> Nuova campagna
        </button>
      </div>

      <div className="bg-white border border-cream-300 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream-50 text-ink-600">
            <tr>
              <th className="text-left px-4 py-2">Nome</th>
              <th className="text-left px-4 py-2">Trigger</th>
              <th className="text-right px-4 py-2">Punti</th>
              <th className="text-right px-4 py-2">Validità</th>
              <th className="text-left px-4 py-2">Periodo</th>
              <th className="text-left px-4 py-2">Stato</th>
              <th className="text-right px-4 py-2">Azioni</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-100">
            {campaigns.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-500">Nessuna campagna.</td></tr>
            ) : campaigns.map((c) => (
              <tr key={c.id} className="hover:bg-cream-50">
                <td className="px-4 py-3 font-semibold text-ink-900">{c.name}</td>
                <td className="px-4 py-3 text-ink-700">{TRIGGER_LABEL[c.trigger_event]}</td>
                <td className="px-4 py-3 text-right">{c.bonus_points}</td>
                <td className="px-4 py-3 text-right">{c.valid_hours}h</td>
                <td className="px-4 py-3 text-xs text-ink-600">{c.starts_at.slice(0, 10)} → {c.ends_at.slice(0, 10)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                    c.status === 'active' ? 'bg-olive-100 text-olive-800' :
                    c.status === 'paused' ? 'bg-accent-100 text-accent-800' :
                    'bg-cream-100 text-ink-600'
                  }`}>{c.status}</span>
                </td>
                <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                  {c.status === 'active' && (
                    <button onClick={() => setStatus.mutate({ id: c.id, status: 'paused' })} className="text-accent-700 hover:text-accent-800 text-xs font-semibold inline-flex items-center gap-1">
                      <Pause size={12} strokeWidth={2.4} /> Pausa
                    </button>
                  )}
                  {c.status === 'paused' && (
                    <button onClick={() => setStatus.mutate({ id: c.id, status: 'active' })} className="text-olive-700 hover:text-olive-800 text-xs font-semibold inline-flex items-center gap-1">
                      <Play size={12} strokeWidth={2.4} /> Riprendi
                    </button>
                  )}
                  <button onClick={() => setEditing({ ...c, starts_at: c.starts_at.slice(0, 16), ends_at: c.ends_at.slice(0, 16) })} className="text-primary-700 hover:text-primary-800 text-xs font-semibold">
                    Modifica
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await confirmDialog({ title: 'Eliminare campagna?', danger: true });
                      if (ok) del.mutate(c.id);
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

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Modifica campagna' : 'Nuova campagna'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Annulla</Button>
            <Button type="submit" form="cashback-form" loading={save.isPending}>Salva</Button>
          </>
        }
      >
        {editing && (
          <form id="cashback-form" onSubmit={(e) => { e.preventDefault(); save.mutate(editing); }} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Nome interno</label>
                <input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Descrizione</label>
                <textarea value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm resize-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Trigger evento</label>
                <select value={editing.trigger_event ?? 'cart_abandoned'} onChange={(e) => setEditing({ ...editing, trigger_event: e.target.value as any })} className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm">
                  {(Object.keys(TRIGGER_LABEL) as Array<keyof typeof TRIGGER_LABEL>).map((k) => (
                    <option key={k} value={k}>{TRIGGER_LABEL[k]}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1">Punti bonus</label>
                  <input type="number" min={0} value={editing.bonus_points ?? 100} onChange={(e) => setEditing({ ...editing, bonus_points: Number(e.target.value) })} className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Validità (ore)</label>
                  <input type="number" min={1} value={editing.valid_hours ?? 24} onChange={(e) => setEditing({ ...editing, valid_hours: Number(e.target.value) })} className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Importo minimo (€)</label>
                <input type="number" min={0} step="0.01" value={(editing.min_order_cents ?? 0) / 100} onChange={(e) => setEditing({ ...editing, min_order_cents: Math.round(Number(e.target.value) * 100) })} className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1">Inizio</label>
                  <input type="datetime-local" value={editing.starts_at as string ?? ''} onChange={(e) => setEditing({ ...editing, starts_at: e.target.value })} className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Fine</label>
                  <input type="datetime-local" value={editing.ends_at as string ?? ''} onChange={(e) => setEditing({ ...editing, ends_at: e.target.value })} className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            </form>
        )}
      </Modal>
    </div>
  );
}

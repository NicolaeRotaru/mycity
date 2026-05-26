'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { confirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';

type Coupon = {
  id: string;
  code: string;
  type: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';
  value: number;
  min_subtotal: number;
  max_uses: number | null;
  uses_count: number;
  first_order_only: boolean;
  active: boolean;
  description: string | null;
};

type CouponType = 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';

const empty: {
  code: string;
  type: CouponType;
  value: number;
  min_subtotal: number;
  max_uses: number | null;
  first_order_only: boolean;
  description: string;
  active: boolean;
} = {
  code: '', type: 'PERCENT', value: 10, min_subtotal: 0,
  max_uses: null, first_order_only: false,
  description: '', active: true,
};

export default function AdminCouponsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(empty);

  const { data: coupons = [], isLoading } = useQuery({
    queryKey: ['admin-coupons'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coupons')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Coupon[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code.toUpperCase().trim(),
        type: form.type,
        value: form.type === 'FREE_SHIPPING' ? 0 : Number(form.value),
        min_subtotal: Number(form.min_subtotal),
        max_uses: form.max_uses ? Number(form.max_uses) : null,
        first_order_only: form.first_order_only,
        description: form.description.trim() || null,
        active: form.active,
      };
      const { error } = await supabase.from('coupons').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-coupons'] });
      setShowForm(false);
      setForm(empty);
      toast.success('Coupon creato');
    },
    onError: (err: any) => toast.error(friendlyError(err)),
  });

  const toggle = useMutation({
    mutationFn: async (c: Coupon) => {
      await supabase.from('coupons').update({ active: !c.active }).eq('id', c.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-coupons'] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('coupons').delete().eq('id', id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-coupons'] });
      toast.success('Coupon eliminato');
    },
  });

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Coupon</h1>
          <p className="text-sm text-ink-500">{coupons.length} codici</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg font-semibold text-sm"
          >
            + Nuovo coupon
          </button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
          className="bg-white border rounded-xl p-5 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-ink-700">Codice</label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="ESTATE25"
                className="w-full border p-2 rounded mt-1 uppercase"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium text-ink-700">Tipo</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as any })}
                className="w-full border p-2 rounded mt-1"
              >
                <option value="PERCENT">Percentuale (%)</option>
                <option value="FIXED">Sconto fisso (€)</option>
                <option value="FREE_SHIPPING">Spedizione gratuita</option>
              </select>
            </div>
            {form.type !== 'FREE_SHIPPING' && (
              <div>
                <label className="text-sm font-medium text-ink-700">Valore</label>
                <input
                  type="number"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
                  className="w-full border p-2 rounded mt-1"
                  min={0}
                  step={form.type === 'PERCENT' ? 1 : 0.5}
                />
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-ink-700">Spesa minima (€)</label>
              <input
                type="number"
                value={form.min_subtotal}
                onChange={(e) => setForm({ ...form, min_subtotal: Number(e.target.value) })}
                className="w-full border p-2 rounded mt-1"
                min={0}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-ink-700">Usi max (vuoto = illimitato)</label>
              <input
                type="number"
                value={form.max_uses ?? ''}
                onChange={(e) => setForm({ ...form, max_uses: e.target.value ? Number(e.target.value) : null })}
                className="w-full border p-2 rounded mt-1"
                min={1}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm font-medium text-ink-700">Descrizione (opzionale)</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full border p-2 rounded mt-1"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.first_order_only} onChange={(e) => setForm({ ...form, first_order_only: e.target.checked })} />
            <span>Valido solo al primo ordine</span>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={create.isPending} className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-5 py-2 rounded font-semibold">
              {create.isPending ? 'Creazione…' : 'Crea coupon'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-ink-600 hover:text-ink-900 px-3">
              Annulla
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-cream-50 border-b text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="p-3 text-left">Codice</th>
              <th className="p-3 text-left">Tipo</th>
              <th className="p-3 text-right">Valore</th>
              <th className="p-3 text-right">Spesa min</th>
              <th className="p-3 text-right">Usi</th>
              <th className="p-3 text-left">Stato</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {coupons.map((c) => (
              <tr key={c.id} className="border-t hover:bg-cream-50">
                <td className="p-3 font-mono font-bold text-ink-900">{c.code}</td>
                <td className="p-3 text-ink-700">
                  {c.type === 'PERCENT' ? 'Sconto %' : c.type === 'FIXED' ? 'Sconto €' : 'Spedizione gratis'}
                  {c.first_order_only && <span className="ml-2 text-xs bg-accent-100 text-accent-700 px-1.5 py-0.5 rounded">1° ordine</span>}
                </td>
                <td className="p-3 text-right font-semibold">
                  {c.type === 'PERCENT' ? `${c.value}%` : c.type === 'FIXED' ? `€${Number(c.value).toFixed(2)}` : '—'}
                </td>
                <td className="p-3 text-right text-ink-600">€{Number(c.min_subtotal).toFixed(2)}</td>
                <td className="p-3 text-right text-ink-600">
                  {c.uses_count}{c.max_uses ? ` / ${c.max_uses}` : ''}
                </td>
                <td className="p-3">
                  <button
                    onClick={() => toggle.mutate(c)}
                    className={`text-xs px-2 py-1 rounded font-semibold ${
                      c.active ? 'bg-olive-100 text-olive-700' : 'bg-cream-100 text-ink-500'
                    }`}
                  >
                    {c.active ? 'Attivo' : 'Disattivato'}
                  </button>
                </td>
                <td className="p-3">
                  <button
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: 'Eliminare il coupon?',
                        message: `Il codice ${c.code} non sarà più utilizzabile dai clienti.`,
                        confirmLabel: 'Sì, elimina',
                        danger: true,
                        icon: '🎟️',
                      });
                      if (ok) remove.mutate(c.id);
                    }}
                    className="text-xs text-rose-600 hover:underline"
                  >
                    Elimina
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

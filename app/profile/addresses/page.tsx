'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { confirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';

type Addr = {
  id: string;
  label: string;
  full_name: string;
  phone: string;
  address: string;
  city: string;
  zip: string;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  is_default: boolean;
};

const empty: Omit<Addr, 'id' | 'is_default'> & { is_default: boolean } = {
  label: 'Casa', full_name: '', phone: '', address: '',
  city: 'Piacenza', zip: '29121', notes: '', lat: null, lng: null,
  is_default: false,
};

export default function AddressesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<typeof empty>(empty);
  const [showForm, setShowForm] = useState(false);

  const { data: addresses = [], isLoading } = useQuery({
    queryKey: ['addresses'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from('user_addresses')
        .select('*')
        .eq('user_id', user.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });
      return (data ?? []) as Addr[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');

      // Geocode best-effort
      let lat: number | null = form.lat;
      let lng: number | null = form.lng;
      try {
        const q = encodeURIComponent(`${form.address}, ${form.zip} ${form.city}, Italia`);
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=it`);
        const json = await res.json();
        if (Array.isArray(json) && json[0]) {
          lat = parseFloat(json[0].lat);
          lng = parseFloat(json[0].lon);
        }
      } catch {}

      const payload = { ...form, lat, lng, user_id: user.id };

      if (form.is_default) {
        // togli default agli altri
        await supabase.from('user_addresses').update({ is_default: false }).eq('user_id', user.id);
      }
      if (editing) {
        await supabase.from('user_addresses').update(payload).eq('id', editing);
      } else {
        await supabase.from('user_addresses').insert(payload);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['addresses'] });
      setShowForm(false);
      setEditing(null);
      setForm(empty);
      toast.success('Indirizzo salvato');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('user_addresses').delete().eq('id', id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['addresses'] });
      toast.success('Indirizzo eliminato');
    },
  });

  const startEdit = (a: Addr) => {
    setForm({ ...a, notes: a.notes ?? '' });
    setEditing(a.id);
    setShowForm(true);
  };

  if (isLoading) return <LoadingState />;

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/profile" className="text-sm text-primary-700 hover:underline">← Profilo</Link>
          <h1 className="text-2xl font-bold text-ink-900 mt-1">I tuoi indirizzi</h1>
        </div>
        {!showForm && (
          <button
            onClick={() => { setEditing(null); setForm(empty); setShowForm(true); }}
            className="bg-primary-700 hover:bg-primary-800 text-white px-4 py-2 rounded-lg font-semibold text-sm"
          >
            + Nuovo
          </button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
          className="bg-white border rounded-xl p-5 space-y-3"
        >
          <h2 className="font-bold">{editing ? 'Modifica indirizzo' : 'Nuovo indirizzo'}</h2>
          <div>
            <label className="text-sm font-medium text-ink-700">Etichetta</label>
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Casa, Ufficio, Mamma…"
              className="w-full border p-2 rounded mt-1"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium text-ink-700">Nome e cognome</label>
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="w-full border p-2 rounded mt-1" required />
          </div>
          <div>
            <label className="text-sm font-medium text-ink-700">Telefono</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full border p-2 rounded mt-1" required />
          </div>
          <div>
            <label className="text-sm font-medium text-ink-700">Indirizzo</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Via Roma 1" className="w-full border p-2 rounded mt-1" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-ink-700">Città</label>
              <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="w-full border p-2 rounded mt-1" required />
            </div>
            <div>
              <label className="text-sm font-medium text-ink-700">CAP</label>
              <input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} className="w-full border p-2 rounded mt-1" required />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-ink-700">Note per il rider</label>
            <input value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Citofono, piano…" className="w-full border p-2 rounded mt-1" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
            <span>Imposta come indirizzo predefinito</span>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={save.isPending} className="bg-primary-700 hover:bg-primary-800 disabled:opacity-50 text-white px-5 py-2 rounded font-semibold">
              {save.isPending ? 'Salvataggio…' : 'Salva'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="text-ink-600 hover:text-ink-900 px-3">
              Annulla
            </button>
          </div>
        </form>
      )}

      {addresses.length === 0 ? (
        <div className="bg-white border rounded-xl p-8 text-center text-ink-500">
          Nessun indirizzo salvato.
        </div>
      ) : (
        <div className="space-y-3">
          {addresses.map((a) => (
            <div key={a.id} className="bg-white border rounded-xl p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-ink-900 flex items-center gap-2">
                  📍 {a.label}
                  {a.is_default && <span className="text-xs bg-olive-100 text-olive-700 px-2 py-0.5 rounded-full font-semibold">Predefinito</span>}
                </p>
                <p className="text-sm text-ink-700 mt-1">{a.full_name}</p>
                <p className="text-sm text-ink-600">{a.address}, {a.zip} {a.city}</p>
                <p className="text-sm text-ink-500">📞 {a.phone}</p>
                {a.notes && <p className="text-xs text-ink-400 italic mt-1">{a.notes}</p>}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button onClick={() => startEdit(a)} className="text-xs text-primary-700 hover:underline">Modifica</button>
                <button
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: 'Eliminare questo indirizzo?',
                      message: a.label ? `Stai per rimuovere "${a.label}".` : undefined,
                      confirmLabel: 'Sì, elimina',
                      danger: true,
                      icon: '📍',
                    });
                    if (ok) remove.mutate(a.id);
                  }}
                  className="text-xs text-rose-600 hover:underline"
                >
                  Elimina
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

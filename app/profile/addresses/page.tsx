'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Phone, Pencil, Trash2, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { confirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { Input, Checkbox } from '@/components/ui/Field';
import { friendlyError } from '@/lib/errors';
import { useTranslations } from 'next-intl';
import { queryKeys } from '@/lib/queries/keys';

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
  const tActions = useTranslations('actions');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<typeof empty>(empty);
  const [showForm, setShowForm] = useState(false);

  const { data: addresses = [], isLoading } = useQuery({
    queryKey: queryKeys.addresses.all,
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
      qc.invalidateQueries({ queryKey: queryKeys.addresses.all });
      setShowForm(false);
      setEditing(null);
      setForm(empty);
      toast.success('Indirizzo salvato');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('user_addresses').delete().eq('id', id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.addresses.all });
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
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-ink-900">I tuoi indirizzi</h1>
        <p className="mt-1 text-sm text-ink-500">Dove consegniamo i tuoi ordini</p>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
          className="bg-white border border-cream-300 rounded-xl p-5 space-y-3"
        >
          <h2 className="font-bold">{editing ? 'Modifica indirizzo' : 'Nuovo indirizzo'}</h2>
          <Input
            label="Etichetta"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Casa, Ufficio, Mamma…"
            required
          />
          <Input
            label="Nome e cognome"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            required
          />
          <Input
            label="Telefono"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            inputMode="tel"
            required
          />
          <Input
            label="Indirizzo"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Via Roma 1"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Città"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              required
            />
            <Input
              label="CAP"
              value={form.zip}
              onChange={(e) => setForm({ ...form, zip: e.target.value })}
              inputMode="numeric"
              required
            />
          </div>
          <Input
            label="Note per il rider"
            value={form.notes ?? ''}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Citofono, piano…"
          />
          <Checkbox
            checked={form.is_default}
            onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
            label="Imposta come indirizzo predefinito"
          />
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending}>Salva</Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setEditing(null); }}>
              Annulla
            </Button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {addresses.map((a) => (
          <div key={a.id} className="flex flex-col rounded-xl border border-cream-300 bg-white p-5">
            <div className="mb-2 flex items-center gap-2">
              <MapPin size={18} className="text-primary-600 shrink-0" aria-hidden />
              <span className="font-bold text-ink-900">{a.label}</span>
              {a.is_default && (
                <span className="rounded-full bg-olive-100 px-2 py-0.5 text-xs font-semibold text-olive-700">
                  Predefinito
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-ink-700">{a.full_name}</p>
            <p className="text-sm text-ink-600">{a.address}, {a.zip} {a.city}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-500">
              <Phone size={14} className="text-ink-500 shrink-0" aria-hidden />
              {a.phone}
            </p>
            {a.notes && <p className="mt-1 text-xs italic text-ink-400">{a.notes}</p>}
            <div className="mt-auto flex gap-2 pt-4">
              <Button variant="secondary" size="sm" icon={Pencil} onClick={() => startEdit(a)}>
                {tActions('edit')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: 'Eliminare questo indirizzo?',
                    message: a.label ? `Stai per rimuovere "${a.label}".` : undefined,
                    confirmLabel: 'Sì, elimina',
                    danger: true,
                    icon: MapPin,
                  });
                  if (ok) remove.mutate(a.id);
                }}
              >
                Elimina
              </Button>
            </div>
          </div>
        ))}

        {/* Tile tratteggiato "aggiungi indirizzo" */}
        {!showForm && (
          <button
            type="button"
            onClick={() => { setEditing(null); setForm(empty); setShowForm(true); }}
            className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-cream-400 bg-transparent font-semibold text-primary-700 transition-colors hover:border-primary-300 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            <Plus size={24} strokeWidth={2.4} aria-hidden />
            Aggiungi indirizzo
          </button>
        )}
      </div>
    </div>
  );
}

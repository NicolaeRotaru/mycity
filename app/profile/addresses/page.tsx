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
      // 12/11/2026 (R03-014) — In modifica le coordinate di partenza erano quelle dell'indirizzo di
      // prima: se cambiava la via e la ricerca della posizione non rispondeva (o non trovava la via
      // nuova), si salvava la via nuova con le coordinate della vecchia. Le rotte d'ordine le
      // prendevano per buone (via, città e CAP combaciano) e il fattorino andava alla casa vecchia.
      // Ora le coordinate restano solo se il testo è lo stesso; altrimenti si parte da vuote.
      const prima = editing ? addresses.find((a) => a.id === editing) : undefined;
      const stessoIndirizzo =
        !!prima && prima.address === form.address && prima.city === form.city && prima.zip === form.zip;
      let lat: number | null = stessoIndirizzo ? form.lat : null;
      let lng: number | null = stessoIndirizzo ? form.lng : null;
      try {
        // 🟠-15: geocoding via proxy server-side (UA corretto, rate-limit, timeout).
        const res = await fetch('/api/geocode', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            q: `${form.address}, ${form.zip} ${form.city}, Italia`,
            // R03-001 — la ricerca strutturata, chiusa sul comune scritto.
            address: form.address,
            city: form.city,
            zip: form.zip,
          }),
        });
        const json = await res.json();
        if (json && json.lat != null && json.lng != null) {
          lat = json.lat;
          lng = json.lng;
        }
      } catch {}

      const payload = { ...form, lat, lng, user_id: user.id };
      // Senza posizione l'ordine si fa lo stesso (la cerca il server): lo si dice al cliente.
      const posizioneNonTrovata = lat == null || lng == null;

      // 5/11/2026 — Le scritture non guardavano l'errore (supabase non lancia: restituisce
      // { error }): il sito diceva «Indirizzo salvato» e svuotava il modulo anche quando
      // non lo era. E il predefinito si toglieva agli altri PRIMA di salvare questo: se il
      // salvataggio cadeva, il cliente restava senza nessun indirizzo predefinito.
      let salvatoId: string | null = editing;
      if (editing) {
        const { error } = await supabase.from('user_addresses').update(payload).eq('id', editing);
        if (error) throw error;
      } else {
        const { data: nuovo, error } = await supabase.from('user_addresses').insert(payload).select('id').single();
        if (error) throw error;
        salvatoId = (nuovo as { id: string } | null)?.id ?? null;
      }
      if (form.is_default && salvatoId) {
        // togli default agli altri, solo dopo che questo è salvato
        const { error } = await supabase
          .from('user_addresses')
          .update({ is_default: false })
          .eq('user_id', user.id)
          .neq('id', salvatoId);
        if (error) throw error;
      }
      return { posizioneNonTrovata };
    },
    onSuccess: (esito) => {
      qc.invalidateQueries({ queryKey: queryKeys.addresses.all });
      setShowForm(false);
      setEditing(null);
      setForm(empty);
      toast.success('Indirizzo salvato');
      if (esito?.posizioneNonTrovata) {
        toast.info('Non abbiamo trovato la posizione sulla mappa: controlla via e CAP. Puoi ordinare lo stesso.');
      }
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('user_addresses').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.addresses.all });
      toast.success('Indirizzo eliminato');
    },
    // 5/11/2026 — Il verde compariva anche quando l'eliminazione non era riuscita.
    onError: (err: unknown) => toast.error(friendlyError(err)),
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
        <p className="text-xs font-bold uppercase tracking-[0.05em] text-primary-700">Account</p>
        <h1 className="mt-0.5 font-serif text-3xl font-extrabold leading-tight text-ink-900 sm:text-[32px]">
          I tuoi indirizzi
        </h1>
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
            className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-cream-400 bg-transparent font-semibold text-primary-700 transition-colors hover:border-primary-300 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700"
          >
            <Plus size={24} strokeWidth={2.4} aria-hidden />
            Aggiungi indirizzo
          </button>
        )}
      </div>
    </div>
  );
}

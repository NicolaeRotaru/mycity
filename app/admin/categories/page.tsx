'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { Button } from '@/components/ui/Button';
import { Input, Select, Checkbox } from '@/components/ui/Field';
import { slugify } from '@/lib/store-site';
import { AdminPageTitle } from '@/components/admin/AdminUI';

/**
 * Admin: gestione categorie. SELECT pubblica; scrittura via /api/admin/categories
 * (service-role). Riordino tramite sort_order + flag "in evidenza" (migration 076).
 */

type Cat = {
  id: string; slug: string; name: string; icon: string | null;
  parent_id: string | null; sort_order: number | null; featured: boolean | null;
};

async function authedFetch(method: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/admin/categories', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'Errore');
  return json;
}

function CatRow({ cat, tops, onDone }: { cat: Cat; tops: Cat[]; onDone: () => void }) {
  const [name, setName] = useState(cat.name);
  const [slug, setSlug] = useState(cat.slug);
  const [icon, setIcon] = useState(cat.icon ?? '');
  const [parentId, setParentId] = useState(cat.parent_id ?? '');
  const [sortOrder, setSortOrder] = useState(cat.sort_order ?? 0);
  const [featured, setFeatured] = useState(!!cat.featured);

  const save = useMutation({
    mutationFn: async () => authedFetch('PATCH', {
      id: cat.id, name, slug, icon, parent_id: parentId || null, sort_order: sortOrder, featured,
    }),
    onSuccess: () => { toast.success('Categoria aggiornata'); onDone(); },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });
  const del = useMutation({
    mutationFn: async () => authedFetch('DELETE', { id: cat.id }),
    onSuccess: () => { toast.success('Categoria eliminata'); onDone(); },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  return (
    <div className={`rounded-xl border p-3 ${cat.parent_id ? 'ml-6 border-cream-200 bg-cream-50/40' : 'border-cream-300 bg-white'}`}>
      <div className="flex flex-wrap items-end gap-2">
        <Input label="Nome" containerClassName="flex-1 min-w-[140px]" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <Input label="Slug" containerClassName="w-40" value={slug} maxLength={60} onChange={(e) => setSlug(e.target.value)} />
        <Input label="Icona" containerClassName="w-20" value={icon} maxLength={8} placeholder="Emoji" onChange={(e) => setIcon(e.target.value)} />
        <Select label="Genitore" containerClassName="w-44" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">— Principale —</option>
          {tops.filter((t) => t.id !== cat.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Input label="Ordine" containerClassName="w-20" type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} />
        <Checkbox containerClassName="mb-2.5" label="In evidenza" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
        <Button className="mb-0.5" size="sm" type="button" loading={save.isPending} onClick={() => save.mutate()}>Salva</Button>
        <button type="button" onClick={() => { if (window.confirm(`Eliminare "${cat.name}"?`)) del.mutate(); }} aria-label="Elimina" className="mb-2 p-2 text-ink-400 hover:text-secondary-600">
          <Trash2 size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export default function AdminCategoriesPage() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('');
  const [newParent, setNewParent] = useState('');

  const { data: cats = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.categories,
    queryFn: async (): Promise<Cat[]> => {
      const { data, error } = await supabase.from('categories').select('*');
      if (error) throw error;
      return (data ?? []) as Cat[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.admin.categories });
    qc.invalidateQueries({ queryKey: queryKeys.categories.showcase });
    qc.invalidateQueries({ queryKey: queryKeys.categories.allList });
  };

  const tops = useMemo(
    () => cats.filter((c) => !c.parent_id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)),
    [cats],
  );
  const childrenOf = (id: string) =>
    cats.filter((c) => c.parent_id === id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));

  const create = useMutation({
    mutationFn: async () => {
      if (!newName.trim()) throw new Error('Inserisci un nome');
      await authedFetch('POST', { name: newName.trim(), slug: slugify(newName), icon: newIcon, parent_id: newParent || null });
    },
    onSuccess: () => { toast.success('Categoria creata'); setNewName(''); setNewIcon(''); setNewParent(''); invalidate(); },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  return (
    <div className="space-y-6">
      <AdminPageTitle
        eyebrow="Contenuti"
        title="Categorie"
        sub="Tassonomia del catalogo: ordine (più basso = prima) e flag “in evidenza” controllano la vetrina categorie in home."
      />

      {/* Crea nuova */}
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="bg-white border border-cream-300 rounded-xl p-4 flex flex-wrap items-end gap-2">
        <Input label="Nuova categoria" containerClassName="flex-1 min-w-[160px]" value={newName} maxLength={60} placeholder="Es: Animali" onChange={(e) => setNewName(e.target.value)} />
        <Input label="Icona" containerClassName="w-20" value={newIcon} maxLength={8} placeholder="Emoji" onChange={(e) => setNewIcon(e.target.value)} />
        <Select label="Genitore" containerClassName="w-44" value={newParent} onChange={(e) => setNewParent(e.target.value)}>
          <option value="">— Principale —</option>
          {tops.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Button type="submit" loading={create.isPending}><Plus size={16} aria-hidden /> Aggiungi</Button>
      </form>

      {isLoading ? (
        <p className="text-sm text-ink-500">Caricamento…</p>
      ) : (
        <div className="space-y-2">
          {tops.map((t) => (
            <div key={t.id} className="space-y-2">
              <CatRow cat={t} tops={tops} onDone={invalidate} />
              {childrenOf(t.id).map((c) => <CatRow key={c.id} cat={c} tops={tops} onDone={invalidate} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

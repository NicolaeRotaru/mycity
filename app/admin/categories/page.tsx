'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Plus, Tags } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { Button } from '@/components/ui/Button';
import { Input, Select, Checkbox } from '@/components/ui/Field';
import { slugify } from '@/lib/store-site';
import { AdminPageTitle } from '@/components/admin/AdminUI';
import { ErrorState } from '@/components/ui/ErrorState';
import EmptyState from '@/components/EmptyState';

/**
 * Admin: gestione categorie. SELECT pubblica; scrittura via /api/admin/categories
 * (service-role). Riordino tramite sort_order + flag "in evidenza" (migration 076).
 */

type Cat = {
  id: string; slug: string; name: string; icon: string | null;
  parent_id: string | null; sort_order: number | null; featured: boolean | null;
  /** Migrazione 159: senza, `select('*')` non la porta e il campo resta vuoto. */
  image_url?: string | null;
  /** Migrazione 363: i prodotti sotto questa categoria si pubblicano solo con allergeni e ingredienti. */
  richiede_dichiarazioni_alimentari?: boolean | null;
};

/** R01-014 (onda 2) — La casella dell'obbligo alimentare, la stessa nei due moduli. */
const ETICHETTA_ALIMENTI = 'Alimenti: obbliga allergeni e ingredienti';

/**
 * R13-004 — Niente `maxLength` sui campi brevi: il browser tagliava in silenzio quello che si
 * incollava oltre il tetto (nome e slug 60, icona 8, foto 500: gli stessi dell'API). Il testo
 * resta intero e, oltre il tetto, l'errore sotto il campo lo dice (come nei moduli della home).
 */
function sopraIlTetto(valore: string, max: number): string | undefined {
  const n = valore.trim().length;
  return n > max
    ? `Troppo lungo: ${n.toLocaleString('it-IT')} caratteri su ${max.toLocaleString('it-IT')}. Accorcialo, così si salva.`
    : undefined;
}

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

function CatRow({ cat, tops, figli = 0, onDone }: { cat: Cat; tops: Cat[]; figli?: number; onDone: () => void }) {
  const [name, setName] = useState(cat.name);
  const [slug, setSlug] = useState(cat.slug);
  const [icon, setIcon] = useState(cat.icon ?? '');
  const [parentId, setParentId] = useState(cat.parent_id ?? '');
  const [sortOrder, setSortOrder] = useState(cat.sort_order ?? 0);
  const [featured, setFeatured] = useState(!!cat.featured);
  const [imageUrl, setImageUrl] = useState(cat.image_url ?? '');
  const obbligoGiaAcceso = cat.richiede_dichiarazioni_alimentari === true;
  const [alimenti, setAlimenti] = useState(obbligoGiaAcceso);

  const save = useMutation({
    mutationFn: async () => authedFetch('PATCH', {
      id: cat.id, name, slug, icon, parent_id: parentId || null, sort_order: sortOrder, featured,
      // Solo se è cambiata: senza la migrazione 159 la colonna non c'è e il salvataggio degli altri
      // campi deve riuscire lo stesso.
      ...(imageUrl.trim() !== (cat.image_url ?? '') ? { image_url: imageUrl.trim() } : {}),
      // Solo se è cambiato, come la foto.
      ...(alimenti !== obbligoGiaAcceso ? { richiede_dichiarazioni_alimentari: alimenti } : {}),
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
        <Input label="Nome" containerClassName="flex-1 min-w-[140px]" value={name} error={sopraIlTetto(name, 60)} onChange={(e) => setName(e.target.value)} />
        <Input label="Slug" containerClassName="w-40" value={slug} error={sopraIlTetto(slug, 60)} onChange={(e) => setSlug(e.target.value)} />
        <Input label="Icona" containerClassName="w-20" value={icon} error={sopraIlTetto(icon, 8)} placeholder="Emoji" onChange={(e) => setIcon(e.target.value)} />
        <Select label="Genitore" containerClassName="w-44" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">— Principale —</option>
          {/* Una principale con sottocategorie non può diventare figlia: le sue
              sottocategorie diventerebbero nipoti, che il pannello non disegna. */}
          {figli === 0 && tops.filter((t) => t.id !== cat.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Input label="Ordine" containerClassName="w-20" type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} />
        <Checkbox containerClassName="mb-2.5" label="In evidenza" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
        {/* R01-014 — Acceso, non si spegne dal pannello (lo rifiuta il database, migrazione 363). */}
        <Checkbox
          containerClassName="mb-2.5"
          label={obbligoGiaAcceso ? `${ETICHETTA_ALIMENTI} (non si toglie dal pannello)` : ETICHETTA_ALIMENTI}
          checked={alimenti}
          disabled={obbligoGiaAcceso}
          onChange={(e) => setAlimenti(e.target.checked)}
        />
        <Input label="Foto della tessera (https://… o /…)" containerClassName="flex-1 min-w-[220px]" value={imageUrl} error={sopraIlTetto(imageUrl, 500)} placeholder="Vuota = gradiente del marchio" onChange={(e) => setImageUrl(e.target.value)} />
        <Button className="mb-0.5" size="sm" type="button" loading={save.isPending} onClick={() => save.mutate()}>Salva</Button>
        <button type="button" onClick={() => {
            if (figli > 0) {
              toast.error(`«${cat.name}» ha ${figli} sottocategori${figli === 1 ? 'a' : 'e'}: spostale o eliminale prima.`);
              return;
            }
            if (window.confirm(`Eliminare «${cat.name}»? Se ci sono prodotti in questa categoria l'eliminazione verrà rifiutata.`)) del.mutate();
          }} aria-label="Elimina" className="mb-2 p-2 text-ink-400 hover:text-secondary-600">
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
  const [newImage, setNewImage] = useState('');
  const [newAlimenti, setNewAlimenti] = useState(false);

  const { data: cats = [], isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.admin.categories,
    queryFn: async (): Promise<Cat[]> => {
      const { data, error } = await supabase.from('categories').select('*');
      if (error) throw error;
      return (data ?? []) as Cat[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.admin.categories });
    qc.invalidateQueries({ queryKey: queryKeys.categories.all });
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
      await authedFetch('POST', {
        name: newName.trim(), slug: slugify(newName), icon: newIcon, parent_id: newParent || null,
        ...(newImage.trim() ? { image_url: newImage.trim() } : {}),
        ...(newAlimenti ? { richiede_dichiarazioni_alimentari: true } : {}),
      });
    },
    onSuccess: () => {
      toast.success('Categoria creata');
      setNewName(''); setNewIcon(''); setNewParent(''); setNewImage(''); setNewAlimenti(false);
      invalidate();
    },
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
        <Input label="Nuova categoria" containerClassName="flex-1 min-w-[160px]" value={newName} error={sopraIlTetto(newName, 60)} placeholder="Es: Animali" onChange={(e) => setNewName(e.target.value)} />
        <Input label="Icona" containerClassName="w-20" value={newIcon} error={sopraIlTetto(newIcon, 8)} placeholder="Emoji" onChange={(e) => setNewIcon(e.target.value)} />
        <Input label="Foto (facoltativa)" containerClassName="flex-1 min-w-[200px]" value={newImage} error={sopraIlTetto(newImage, 500)} placeholder="https://… o /…" onChange={(e) => setNewImage(e.target.value)} />
        <Select label="Genitore" containerClassName="w-44" value={newParent} onChange={(e) => setNewParent(e.target.value)}>
          <option value="">— Principale —</option>
          {tops.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Checkbox containerClassName="mb-2.5" label={ETICHETTA_ALIMENTI} checked={newAlimenti} onChange={(e) => setNewAlimenti(e.target.checked)} />
        <Button type="submit" loading={create.isPending}><Plus size={16} aria-hidden /> Aggiungi</Button>
        {!newParent && !newAlimenti && (
          <p role="note" className="w-full text-xs text-ink-500">
            Una categoria principale nuova nasce senza l&apos;obbligo di allergeni e ingredienti: spuntalo se ci vanno alimenti.
          </p>
        )}
      </form>

      {isLoading ? (
        <p className="text-sm text-ink-500">Caricamento…</p>
      ) : isError ? (
        <ErrorState
          variant="compact"
          title="Non riesco a leggere le categorie"
          description="Non vuol dire che non ce ne siano: la lettura non è andata. Riprova."
          retry={() => { void refetch(); }}
          supportHref={null}
        />
      ) : cats.length === 0 ? (
        <EmptyState
          variant="compact"
          icon={Tags}
          title="Nessuna categoria ancora"
          description="Scrivi un nome nel modulo qui sopra e premi «Aggiungi»: sarà la prima categoria del catalogo."
        />
      ) : (
        <div className="space-y-2">
          {tops.map((t) => (
            <div key={t.id} className="space-y-2">
              <CatRow cat={t} tops={tops} figli={childrenOf(t.id).length} onDone={invalidate} />
              {childrenOf(t.id).map((c) => <CatRow key={c.id} cat={c} tops={tops} onDone={invalidate} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

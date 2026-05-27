'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus, Star } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

/**
 * /lists — Liste curate (tastemakers).
 *
 * Esperti senior consultati:
 * - Senior PM: "Power users diventano tastemakers → discovery secondaria."
 * - Behavioral Scientist: "Social proof: 'la lista di @marco' > algoritmo."
 * - Content Designer: "Titolo + 1 emoji = identità della lista."
 * - Trust & Safety: "Default privata. Opt-in al pubblico esplicito."
 */

type List = {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  cover_emoji: string | null;
  is_public: boolean;
  is_featured: boolean;
  updated_at: string;
  owner: { public_handle: string | null; full_name: string | null } | null;
  items_count: { count: number }[];
};

export default function ListsPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newEmoji, setNewEmoji] = useState('⭐');
  const [newDesc, setNewDesc] = useState('');

  const { data: featuredLists = [] } = useQuery({
    queryKey: queryKeys.lists.featuredV2,
    queryFn: async (): Promise<List[]> => {
      const { data } = await supabase
        .from('product_lists')
        .select(`
          id, owner_id, title, description, cover_emoji, is_public, is_featured, updated_at,
          owner:profiles!product_lists_owner_id_fkey ( public_handle, full_name ),
          items_count:product_list_items(count)
        `)
        .eq('is_public', true)
        .eq('is_featured', true)
        .order('updated_at', { ascending: false })
        .limit(8);
      return (data ?? []) as unknown as List[];
    },
  });

  const { data: publicLists = [] } = useQuery({
    queryKey: queryKeys.lists.publicV2,
    queryFn: async (): Promise<List[]> => {
      const { data } = await supabase
        .from('product_lists')
        .select(`
          id, owner_id, title, description, cover_emoji, is_public, is_featured, updated_at,
          owner:profiles!product_lists_owner_id_fkey ( public_handle, full_name ),
          items_count:product_list_items(count)
        `)
        .eq('is_public', true)
        .order('updated_at', { ascending: false })
        .limit(24);
      return (data ?? []) as unknown as List[];
    },
  });

  const { data: myLists = [] } = useQuery({
    queryKey: queryKeys.lists.mine,
    queryFn: async (): Promise<List[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from('product_lists')
        .select(`
          id, owner_id, title, description, cover_emoji, is_public, is_featured, updated_at,
          items_count:product_list_items(count)
        `)
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false });
      return (data ?? []) as unknown as List[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!newTitle.trim()) throw new Error('Titolo obbligatorio');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Accedi per creare una lista');
      const { data, error } = await supabase
        .from('product_lists')
        .insert({
          owner_id: user.id,
          title: newTitle.trim(),
          description: newDesc.trim() || null,
          cover_emoji: newEmoji.trim() || '⭐',
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      toast.success('Lista creata');
      setShowNew(false);
      setNewTitle(''); setNewDesc(''); setNewEmoji('⭐');
      qc.invalidateQueries({ queryKey: queryKeys.lists.mine });
      window.location.href = `/lists/${id}`;
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const ListCard = ({ list }: { list: List }) => {
    const count = list.items_count?.[0]?.count ?? 0;
    return (
      <Link
        href={`/lists/${list.id}`}
        className="bg-white border border-cream-300 rounded-xl p-4 hover:shadow-warm transition-shadow flex gap-3"
      >
        <div className="w-14 h-14 rounded-lg bg-cream-100 flex items-center justify-center text-3xl flex-shrink-0">
          {list.cover_emoji ?? '⭐'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-ink-900 truncate">{list.title}</h3>
            {list.is_featured && <Star size={14} className="text-accent-500 fill-accent-500 flex-shrink-0" />}
          </div>
          {list.description && <p className="text-xs text-ink-500 line-clamp-2 mt-0.5">{list.description}</p>}
          <p className="text-xs text-ink-400 mt-1">
            {count} {count === 1 ? 'prodotto' : 'prodotti'}
            {list.owner?.public_handle && ` · @${list.owner.public_handle}`}
          </p>
        </div>
      </Link>
    );
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl space-y-10">
      <header className="text-center space-y-2">
        <span className="inline-flex items-center gap-1.5 bg-secondary-100 text-secondary-800 px-3 py-1 rounded-full text-xs font-bold tracking-wide">
          <ListChecks size={14} strokeWidth={2.4} />
          Liste curate
        </span>
        <h1 className="font-serif text-3xl md:text-4xl font-bold text-ink-900">
          Cosa comprano i piacentini
        </h1>
        <p className="text-ink-600 max-w-2xl mx-auto">
          Liste di prodotti scelte da altri utenti. Lasciati ispirare o crea la tua.
        </p>
      </header>

      {/* Le tue liste */}
      {myLists.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-ink-900">Le tue liste</h2>
            <button
              onClick={() => setShowNew(true)}
              className="inline-flex items-center gap-1.5 text-primary-700 hover:text-primary-800 font-semibold text-sm"
            >
              <Plus size={14} strokeWidth={2.4} /> Nuova lista
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {myLists.map((l) => <ListCard key={l.id} list={l} />)}
          </div>
        </section>
      )}

      {myLists.length === 0 && (
        <section className="bg-cream-50 border border-cream-300 rounded-2xl p-8 text-center">
          <ListChecks size={32} className="mx-auto text-ink-300 mb-3" strokeWidth={1.5} />
          <p className="text-ink-700 mb-3">Non hai ancora liste. Inizia a crearne una.</p>
          <Button onClick={() => setShowNew(true)} size="sm" icon={Plus}>Crea la prima lista</Button>
        </section>
      )}

      {/* Featured liste */}
      {featuredLists.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Star size={18} className="text-accent-500 fill-accent-500" />
            <h2 className="font-bold text-ink-900">Liste in evidenza</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {featuredLists.map((l) => <ListCard key={l.id} list={l} />)}
          </div>
        </section>
      )}

      {/* Tutte le liste pubbliche */}
      <section>
        <h2 className="font-bold text-ink-900 mb-3">Liste della community</h2>
        {publicLists.length === 0 ? (
          <p className="text-sm text-ink-500">Nessuna lista pubblica per ora.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {publicLists.map((l) => <ListCard key={l.id} list={l} />)}
          </div>
        )}
      </section>

      {/* Modal nuova lista */}
      <Modal
        open={showNew}
        onClose={() => setShowNew(false)}
        title="Nuova lista"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowNew(false)}>Annulla</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !newTitle.trim()} loading={create.isPending}>
              Crea lista
            </Button>
          </>
        }
      >
            <div className="space-y-4">
              <div className="grid grid-cols-[80px_1fr] gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1">Emoji</label>
                  <input
                    value={newEmoji}
                    onChange={(e) => setNewEmoji(e.target.value)}
                    maxLength={4}
                    className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-2xl text-center"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Titolo</label>
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    maxLength={60}
                    placeholder="I miei essenziali per la colazione"
                    className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Descrizione (opz.)</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  maxLength={200}
                  rows={2}
                  className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
            </div>
      </Modal>
    </div>
  );
}

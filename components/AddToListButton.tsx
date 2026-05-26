'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';

/**
 * Pulsante "Aggiungi a lista" sulle product page.
 *
 * Esperti senior consultati:
 * - UX Designer: "Mostra le liste esistenti + 1 click create. Non navigation jump."
 * - Behavioral Scientist: "Permette save-for-later anche senza wishlist =
 *   collezione mentale più strutturata."
 */

type List = { id: string; title: string; cover_emoji: string | null };

export default function AddToListButton({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');

  const { data: lists = [] } = useQuery({
    queryKey: ['lists-mine-min'],
    enabled: open,
    queryFn: async (): Promise<List[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from('product_lists')
        .select('id, title, cover_emoji')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false });
      return (data ?? []) as List[];
    },
  });

  const { data: inLists = [] } = useQuery({
    queryKey: ['lists-containing', productId],
    enabled: open,
    queryFn: async (): Promise<string[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: myLists } = await supabase.from('product_lists').select('id').eq('owner_id', user.id);
      if (!myLists?.length) return [];
      const { data } = await supabase
        .from('product_list_items')
        .select('list_id')
        .in('list_id', myLists.map((l: any) => l.id))
        .eq('product_id', productId);
      return ((data ?? []) as any[]).map((r) => r.list_id);
    },
  });

  const toggle = useMutation({
    mutationFn: async (listId: string) => {
      const inIt = inLists.includes(listId);
      if (inIt) {
        const { error } = await supabase
          .from('product_list_items')
          .delete()
          .eq('list_id', listId)
          .eq('product_id', productId);
        if (error) throw error;
        return false;
      } else {
        const { error } = await supabase
          .from('product_list_items')
          .insert({ list_id: listId, product_id: productId });
        if (error) throw error;
        return true;
      }
    },
    onSuccess: (added) => {
      toast.success(added ? 'Aggiunto alla lista' : 'Rimosso dalla lista');
      qc.invalidateQueries({ queryKey: ['lists-containing', productId] });
      qc.invalidateQueries({ queryKey: ['list-items'] });
    },
    onError: (err: any) => toast.error(friendlyError(err)),
  });

  const createAndAdd = useMutation({
    mutationFn: async () => {
      if (!newListTitle.trim()) throw new Error('Titolo obbligatorio');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Accedi');
      const { data: list, error: e1 } = await supabase
        .from('product_lists')
        .insert({ owner_id: user.id, title: newListTitle.trim(), cover_emoji: '⭐' })
        .select('id')
        .single();
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from('product_list_items')
        .insert({ list_id: list.id, product_id: productId });
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success('Lista creata e prodotto aggiunto');
      setNewListTitle('');
      qc.invalidateQueries({ queryKey: ['lists-mine-min'] });
      qc.invalidateQueries({ queryKey: ['lists-containing', productId] });
    },
    onError: (err: any) => toast.error(friendlyError(err)),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold bg-cream-100 hover:bg-cream-200 text-ink-700 border border-cream-300 px-3 py-1.5 rounded-full"
      >
        <ListChecks size={12} strokeWidth={2.4} />
        Aggiungi a lista
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-warm-lg">
            <div className="px-5 py-4 border-b border-cream-200 flex items-center justify-between">
              <h2 className="font-bold">Aggiungi alle tue liste</h2>
              <button onClick={() => setOpen(false)} aria-label="Chiudi"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
              {lists.length === 0 ? (
                <p className="text-sm text-ink-500">Non hai ancora liste. Creane una qui sotto.</p>
              ) : (
                <ul className="space-y-2">
                  {lists.map((l) => {
                    const inIt = inLists.includes(l.id);
                    return (
                      <li key={l.id}>
                        <button
                          onClick={() => toggle.mutate(l.id)}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg border ${
                            inIt ? 'bg-olive-50 border-olive-200' : 'bg-cream-50 border-cream-200 hover:bg-cream-100'
                          }`}
                        >
                          <span className="text-2xl flex-shrink-0">{l.cover_emoji ?? '⭐'}</span>
                          <span className="flex-1 text-left font-semibold text-sm text-ink-900">{l.title}</span>
                          {inIt && <Check size={16} className="text-olive-700 flex-shrink-0" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="pt-3 border-t border-cream-200">
                <label className="block text-sm font-semibold mb-1">+ Crea nuova lista</label>
                <div className="flex gap-2">
                  <input
                    value={newListTitle}
                    onChange={(e) => setNewListTitle(e.target.value)}
                    placeholder="Es: I miei essenziali"
                    maxLength={60}
                    className="flex-1 bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm"
                  />
                  <button
                    onClick={() => createAndAdd.mutate()}
                    disabled={!newListTitle.trim() || createAndAdd.isPending}
                    className="bg-primary-700 hover:bg-primary-800 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-1"
                  >
                    <Plus size={12} strokeWidth={2.4} /> Crea
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

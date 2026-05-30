'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Eye, EyeOff, Trash2, Share2, ListChecks } from 'lucide-react';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { confirmDialog } from '@/components/ConfirmDialog';
import { friendlyError } from '@/lib/errors';
import { useTranslations } from 'next-intl';
import EmptyState from '@/components/EmptyState';
import { queryKeys } from '@/lib/queries/keys';

/**
 * /lists/[id] — Detail di una lista.
 *
 * Esperti senior consultati:
 * - UX Designer: "Edit inline per owner. Read-only per visitor. Toggle visibility
 *   con feedback chiaro."
 * - Behavioral Scientist: "Pulsante share = viralità potenziale."
 * - Content Designer: "Note per ogni prodotto = perché è in lista. Voce
 *   personale > spec tecnica."
 */

type ListData = {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  cover_emoji: string | null;
  is_public: boolean;
  updated_at: string;
  owner: { public_handle: string | null; full_name: string | null } | null;
};

type Item = {
  list_id: string;
  product_id: string;
  sort_order: number;
  note: string | null;
  product: {
    id: string;
    name: string;
    price: number;
    images: string[] | null;
    status: string;
  } | null;
};

export default function ListDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const router = useRouter();
  const qc = useQueryClient();
  const tActions = useTranslations('actions');
  const tToasts = useTranslations('toasts');
  const [userId, setUserId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState(false);
  const [titleVal, setTitleVal] = useState('');
  const [descVal, setDescVal] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null));
  }, []);

  const { data: list } = useQuery({
    queryKey: queryKeys.lists.detail(params.id),
    queryFn: async (): Promise<ListData | null> => {
      const { data } = await supabase
        .from('product_lists')
        .select(`
          id, owner_id, title, description, cover_emoji, is_public, updated_at,
          owner:profiles!product_lists_owner_id_fkey ( public_handle, full_name )
        `)
        .eq('id', params.id)
        .maybeSingle();
      return data as unknown as ListData | null;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: queryKeys.lists.items(params.id),
    queryFn: async (): Promise<Item[]> => {
      const { data } = await supabase
        .from('product_list_items')
        .select(`
          list_id, product_id, sort_order, note,
          product:products!product_list_items_product_id_fkey ( id, name, price, images, status )
        `)
        .eq('list_id', params.id)
        .order('sort_order', { ascending: true });
      return (data ?? []) as unknown as Item[];
    },
  });

  useEffect(() => {
    if (list) {
      setTitleVal(list.title);
      setDescVal(list.description ?? '');
    }
  }, [list]);

  const isOwner = userId && list?.owner_id === userId;

  const updateMeta = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('product_lists')
        .update({ title: titleVal.trim(), description: descVal.trim() || null, updated_at: new Date().toISOString() })
        .eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tToasts('updated'));
      setEditTitle(false);
      qc.invalidateQueries({ queryKey: queryKeys.lists.detail(params.id) });
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const toggleVisibility = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('product_lists')
        .update({ is_public: !list?.is_public, updated_at: new Date().toISOString() })
        .eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(list?.is_public ? 'Lista resa privata' : 'Lista resa pubblica');
      qc.invalidateQueries({ queryKey: queryKeys.lists.detail(params.id) });
    },
  });

  const removeItem = useMutation({
    mutationFn: async (productId: string) => {
      const { error } = await supabase
        .from('product_list_items')
        .delete()
        .eq('list_id', params.id)
        .eq('product_id', productId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.lists.items(params.id) });
    },
  });

  const updateNote = useMutation({
    mutationFn: async (vars: { productId: string; note: string }) => {
      const { error } = await supabase
        .from('product_list_items')
        .update({ note: vars.note.trim() || null })
        .eq('list_id', params.id)
        .eq('product_id', vars.productId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.lists.items(params.id) });
    },
  });

  const deleteList = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('product_lists').delete().eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Lista eliminata');
      router.push('/lists');
    },
  });

  if (!list) {
    return <div className="container mx-auto py-12 max-w-2xl"><EmptyState icon={ListChecks} title="Lista non trovata" description="Forse è stata cancellata o non è pubblica." ctaLabel="Tutte le liste" ctaHref="/lists" /></div>;
  }

  const share = async () => {
    const url = `${window.location.origin}/lists/${list.id}`;
    if (navigator.share) {
      try { await navigator.share({ title: list.title, url }); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      toast.success('Link copiato');
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
      <Breadcrumb items={[
        { label: 'Home', href: '/' },
        { label: 'Liste curate', href: '/lists' },
        { label: list.title },
      ]} />

      <header className="bg-white border border-cream-300 rounded-2xl p-6 flex items-start gap-4">
        <div className="text-5xl flex-shrink-0">{list.cover_emoji ?? '⭐'}</div>
        <div className="flex-1 min-w-0">
          {editTitle && isOwner ? (
            <div className="space-y-2">
              <input
                value={titleVal}
                onChange={(e) => setTitleVal(e.target.value)}
                className="w-full text-2xl font-serif font-bold bg-cream-50 border border-cream-300 rounded-lg px-3 py-1"
                maxLength={60}
              />
              <textarea
                value={descVal}
                onChange={(e) => setDescVal(e.target.value)}
                placeholder="Descrizione (opz.)"
                rows={2}
                maxLength={200}
                className="w-full text-sm bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 resize-none"
              />
              <div className="flex gap-2">
                <button onClick={() => updateMeta.mutate()} disabled={updateMeta.isPending} className="bg-primary-700 text-white px-3 py-1 rounded-lg text-sm font-bold">{tActions('save')}</button>
                <button onClick={() => setEditTitle(false)} className="text-ink-500 px-3 py-1 rounded-lg text-sm">{tActions('cancel')}</button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-serif font-bold text-ink-900">{list.title}</h1>
              {list.description && <p className="text-sm text-ink-600 mt-1">{list.description}</p>}
              {list.owner?.public_handle && (
                <Link href={`/u/${list.owner.public_handle}`} className="text-xs text-primary-700 hover:underline mt-1 inline-block">
                  @{list.owner.public_handle}
                </Link>
              )}
            </>
          )}
        </div>
        <div className="flex flex-col gap-2 flex-shrink-0">
          {isOwner && !editTitle && (
            <>
              <button onClick={() => setEditTitle(true)} aria-label="Modifica" className="text-ink-500 hover:text-ink-700"><Pencil size={16} /></button>
              <button onClick={() => toggleVisibility.mutate()} aria-label={list.is_public ? 'Rendi privata' : 'Rendi pubblica'} className="text-ink-500 hover:text-ink-700">
                {list.is_public ? <Eye size={16} className="text-olive-700" /> : <EyeOff size={16} />}
              </button>
              <button
                onClick={async () => {
                  const ok = await confirmDialog({ title: 'Eliminare la lista?', danger: true });
                  if (ok) deleteList.mutate();
                }}
                aria-label="Elimina"
                className="text-rose-600 hover:text-rose-800"
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
          {list.is_public && (
            <button onClick={share} aria-label="Condividi" className="text-ink-500 hover:text-ink-700"><Share2 size={16} /></button>
          )}
        </div>
      </header>

      {items.length === 0 ? (
        <div className="bg-white border border-cream-300 rounded-2xl p-8 text-center">
          <p className="text-ink-500 mb-2">Lista vuota.</p>
          <p className="text-xs text-ink-400">
            Aggiungi prodotti dalla pagina di un prodotto (futuro: pulsante &quot;Aggiungi a lista&quot;).
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => {
            const p = it.product;
            if (!p) return null;
            const img = p.images?.[0];
            return (
              <li key={p.id} className="bg-white border border-cream-300 rounded-xl p-4 flex gap-3 items-start">
                <Link href={`/product/${p.id}`} className="flex-shrink-0">
                  {img ? (
                    <Image src={sizedImage(img, 'thumb')} alt="" width={72} height={72} className="rounded-lg object-cover w-18 h-18" />
                  ) : (
                    <div className="w-18 h-18 rounded-lg bg-cream-100 flex items-center justify-center text-2xl">📦</div>
                  )}
                </Link>
                <div className="flex-1 min-w-0">
                  <Link href={`/product/${p.id}`} className="block">
                    <p className="font-semibold text-ink-900 truncate hover:text-primary-700">{p.name}</p>
                    <p className="text-sm font-bold text-primary-700">{formatPrice(Number(p.price))}</p>
                  </Link>
                  {isOwner ? (
                    <input
                      defaultValue={it.note ?? ''}
                      placeholder="Perché l'hai messo in lista?"
                      onBlur={(e) => {
                        if (e.target.value !== (it.note ?? '')) {
                          updateNote.mutate({ productId: p.id, note: e.target.value });
                        }
                      }}
                      className="w-full mt-1 text-xs bg-cream-50 border border-cream-200 rounded px-2 py-1"
                      maxLength={140}
                    />
                  ) : it.note ? (
                    <p className="text-xs text-ink-600 italic mt-1">&quot;{it.note}&quot;</p>
                  ) : null}
                </div>
                {isOwner && (
                  <button
                    onClick={() => removeItem.mutate(p.id)}
                    aria-label="Rimuovi"
                    className="flex-shrink-0 text-rose-500 hover:text-rose-700"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

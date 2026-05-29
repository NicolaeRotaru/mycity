'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import StoreAvatar from './StoreAvatar';
import StoryViewer, { type StoryItem } from './StoryViewer';

type Props = {
  sellerId: string;
  logoUrl?: string | null;
  storeName?: string | null;
};

/**
 * Logo del negozio con anello "storia" stile Instagram.
 * Mostrato SOLO nella pagina del negozio. Se il negozio ha storie attive
 * (non scadute), il logo è racchiuso in un anello gradiente cliccabile che
 * apre il viewer fullscreen; altrimenti renderizza il logo normale.
 */
export default function StoreStoryRing({ sellerId, logoUrl, storeName }: Props) {
  const [open, setOpen] = useState(false);

  const { data: stories = [] } = useQuery({
    queryKey: ['store-stories', sellerId],
    queryFn: async (): Promise<StoryItem[]> => {
      const { data } = await supabase
        .from('seller_stories')
        .select(`
          id, image_url, caption, link_url,
          seller:profiles!seller_stories_seller_id_fkey ( id, store_name, store_logo )
        `)
        .eq('seller_id', sellerId)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      return (data ?? []) as unknown as StoryItem[];
    },
    staleTime: 60_000,
  });

  // Nessuna storia: logo "normale" con bordino bianco (come prima).
  if (stories.length === 0) {
    return (
      <span className="block rounded-full p-1 bg-white">
        <StoreAvatar logoUrl={logoUrl} storeName={storeName} size="xl" />
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Guarda le storie di ${storeName ?? 'questo negozio'}`}
        className="block rounded-full p-1 bg-gradient-to-tr from-primary-500 via-accent-500 to-secondary-500 transition-transform hover:scale-105"
      >
        <span className="block rounded-full p-1 bg-white">
          <StoreAvatar logoUrl={logoUrl} storeName={storeName} size="xl" />
        </span>
      </button>
      {open && <StoryViewer stories={stories} startIndex={0} onClose={() => setOpen(false)} />}
    </>
  );
}

'use client';

import { useMemo, useState } from 'react';
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

  const { data: storie = [] } = useQuery({
    queryKey: ['store-stories', sellerId],
    queryFn: async (): Promise<Omit<StoryItem, 'seller'>[]> => {
      const { data } = await supabase
        .from('seller_stories')
        .select('id, image_url, caption, link_url')
        .eq('seller_id', sellerId)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      return (data ?? []) as Omit<StoryItem, 'seller'>[];
    },
    staleTime: 60_000,
  });

  // 18/10/2026 — Insegna, logo e link del visualizzatore arrivano dalla pagina
  // del negozio, che li ha già letti dalla vista pubblica dei negozi. Prima si
  // rileggevano dalla tabella dei profili: dopo le migrazioni 110, 112 e 161
  // quella tabella mostra a ognuno solo la propria riga, e le storie si
  // sarebbero aperte senza dire di chi sono.
  // Sempre lo stesso elenco finché non cambiano i dati: il visualizzatore
  // riparte il conto alla rovescia quando l'elenco cambia.
  const stories: StoryItem[] = useMemo(
    () =>
      storie.map((s) => ({
        ...s,
        seller: { id: sellerId, store_name: storeName ?? null, store_logo: logoUrl ?? null },
      })),
    [storie, sellerId, storeName, logoUrl],
  );

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

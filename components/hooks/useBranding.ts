'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';
import { normalizeBranding, type Branding } from '@/lib/site-branding';

/**
 * Branding globale (barra annunci, wordmark, footer) letto da site_settings.branding
 * (SELECT pubblica). Cache condivisa: Navbar, PromoTicker e Footer usano la stessa
 * queryKey → una sola fetch. Fallback ai default (testi attuali) finché la riga non
 * esiste / non è caricata.
 */
export function useBranding(): Branding {
  const { data } = useQuery({
    queryKey: queryKeys.branding.public,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Branding> => {
      const { data, error } = await supabase.from('site_settings').select('branding').eq('id', 1).maybeSingle();
      if (error) throw error;
      return normalizeBranding((data as { branding?: unknown } | null)?.branding);
    },
  });
  return data ?? normalizeBranding(null);
}

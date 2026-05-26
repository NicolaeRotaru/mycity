'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';

export const useFavorites = () => {
  const qc = useQueryClient();

  const { data: favorites = new Set<string>() } = useQuery({
    queryKey: queryKeys.favorites.all,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return new Set<string>();
      const { data } = await supabase
        .from('favorites')
        .select('product_id')
        .eq('user_id', user.id);
      return new Set<string>((data ?? []).map((f: any) => f.product_id));
    },
    staleTime: 30_000,
  });

  const toggle = useMutation({
    mutationFn: async (productId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('AUTH_REQUIRED');
      const isFav = favorites.has(productId);
      if (isFav) {
        await supabase.from('favorites').delete().eq('user_id', user.id).eq('product_id', productId);
      } else {
        await supabase.from('favorites').insert({ user_id: user.id, product_id: productId });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.favorites.all }),
  });

  return { favorites, toggle };
};

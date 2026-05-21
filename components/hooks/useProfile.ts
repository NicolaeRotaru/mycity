'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

export type Role = 'buyer' | 'seller' | 'pending_approval';

export type Profile = {
  id: string;
  role: Role;
  is_approved: boolean;
  store_name: string | null;
  full_name: string | null;
  email: string | null;
};

export const useProfile = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setUserEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      setUserId(session?.user?.id ?? null);
      setUserEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const query = useQuery({
    queryKey: ['auth-profile', userId],
    queryFn: async (): Promise<Profile | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, is_approved, store_name, full_name')
        .eq('id', userId)
        .single();
      if (error) return null;
      return { ...data, email: userEmail };
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
  });

  const profile = query.data ?? null;
  const role = profile?.role;

  return {
    profile,
    isLoading: query.isLoading,
    isAuthenticated: !!profile,
    isBuyer: role === 'buyer',
    isSeller: role === 'seller' && !!profile?.is_approved,
    isPendingSeller: role === 'pending_approval',
    isApproved: !!profile?.is_approved,
  };
};

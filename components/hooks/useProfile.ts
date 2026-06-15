'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { identify, resetUser } from '@/lib/analytics/posthog';
import { setSentryUser } from '@/lib/analytics/sentry';
import { queryKeys } from '@/lib/queries/keys';

export type Role = 'buyer' | 'seller' | 'rider' | 'admin' | 'pending_approval';

export type Profile = {
  id: string;
  role: Role;
  is_approved: boolean;
  store_name: string | null;
  store_logo: string | null;
  full_name: string | null;
  email: string | null;
  subscription_status: string | null;
};

export const useProfile = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      const em = data.user?.email ?? null;
      setUserId(uid);
      setUserEmail(em);
      setAuthChecked(true);
      if (uid) { identify(uid, { email: em }); setSentryUser(uid, em ?? undefined); }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const uid = session?.user?.id ?? null;
      const em = session?.user?.email ?? null;
      setUserId(uid);
      setUserEmail(em);
      setAuthChecked(true);
      if (event === 'SIGNED_IN' && uid) { identify(uid, { email: em }); setSentryUser(uid, em ?? undefined); }
      if (event === 'SIGNED_OUT') { resetUser(); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const query = useQuery({
    queryKey: queryKeys.profile.authByUser(userId ?? ''),
    queryFn: async (): Promise<Profile | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, is_approved, store_name, store_logo, full_name, subscription_status')
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
  const isAuthenticated = !!userId;

  return {
    profile,
    userEmail,
    isLoading: !authChecked || (isAuthenticated && query.isLoading),
    isAuthenticated,
    isBuyer: role === 'buyer',
    isSeller: role === 'seller',
    isRider: role === 'rider',
    isAdmin: role === 'admin',
  };
};

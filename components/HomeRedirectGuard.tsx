'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from './hooks/useProfile';

/**
 * Reindirizza seller, rider e admin alla loro dashboard quando atterrano
 * sulla homepage del marketplace. Loro hanno una "home" diversa.
 *
 * Lasciamo il buyer e il guest sulla home pubblica.
 *
 * Componente invisibile, da montare in app/page.tsx.
 */
export default function HomeRedirectGuard() {
  const router = useRouter();
  const { isSeller, isRider, isAdmin, isLoading } = useProfile();

  useEffect(() => {
    if (isLoading) return;
    if (isAdmin)  { router.replace('/admin'); return; }
    if (isSeller) { router.replace('/seller/dashboard'); return; }
    if (isRider)  { router.replace('/rider'); return; }
  }, [isLoading, isSeller, isRider, isAdmin, router]);

  return null;
}

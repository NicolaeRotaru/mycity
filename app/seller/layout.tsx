'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from '@/components/hooks/useProfile';

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { profile, isAuthenticated, isLoading, isSeller, isAdmin } = useProfile();
  const allowed = (isSeller && profile?.is_approved) || isAdmin;

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/sign-in?returnTo=/seller');
    } else if (!allowed) {
      router.replace('/');
    }
  }, [isAuthenticated, allowed, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return <div className="container mx-auto p-8 text-center text-gray-500">Caricamento...</div>;
  }

  if (!allowed) {
    return (
      <div className="container mx-auto p-8 text-center">
        <p className="text-gray-500 text-lg">Accesso riservato ai venditori approvati.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-6xl">
      <main>{children}</main>
    </div>
  );
}

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from '@/components/hooks/useProfile';
import SOSButton from '@/components/rider/SOSButton';

export default function RiderLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading, isRider, isAdmin } = useProfile();
  const allowed = isRider || isAdmin;

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/sign-in?returnTo=/rider');
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
        <p className="text-gray-500 text-lg">Accesso riservato ai rider.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-6xl">
      <main>{children}</main>
      {isRider && <SOSButton />}
    </div>
  );
}

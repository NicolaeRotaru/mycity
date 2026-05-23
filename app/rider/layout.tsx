'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import RiderSidebar from '@/components/RiderSidebar';
import { useProfile } from '@/components/hooks/useProfile';

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
    <div className="container mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
      <RiderSidebar />
      <main>{children}</main>
    </div>
  );
}

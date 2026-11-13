'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from '@/components/hooks/useProfile';
import { LoadingState } from '@/components/ui/LoadingState';
import RiderShell from '@/components/rider/RiderShell';

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
    return <LoadingState />;
  }

  if (!allowed) {
    return (
      <div className="container mx-auto p-8 text-center">
        <p className="text-ink-500 text-lg">Accesso riservato ai rider.</p>
      </div>
    );
  }

  // Shell mobile "phone-shaped" con bottom tab bar dedicata. La chrome globale
  // (Navbar/Footer/MobileTabBar) si nasconde su /rider come per /seller e /admin.
  // SOS solo per rider veri (P0-7): un admin che ispeziona /rider non lo vede.
  return <RiderShell showSOS={isRider}>{children}</RiderShell>;
}

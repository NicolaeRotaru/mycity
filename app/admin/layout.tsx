'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from '@/components/hooks/useProfile';
import { LoadingState } from '@/components/ui/LoadingState';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { profile, isAuthenticated, isLoading } = useProfile();
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/sign-in');
    } else if (!isAdmin) {
      router.replace('/');
    }
  }, [isAuthenticated, isAdmin, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return <LoadingState />;
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-8 text-center">
        <p className="text-ink-500 text-lg">Accesso riservato agli amministratori.</p>
      </div>
    );
  }

  // La navigazione admin vive ora nel menu "Tu" (account menu). Qui resta solo
  // il contenuto a piena larghezza; sotto l'icona scudo c'è la dashboard.
  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-5xl">
      <main>{children}</main>
    </div>
  );
}

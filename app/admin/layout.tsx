'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '@/components/AdminSidebar';
import { useProfile } from '@/components/hooks/useProfile';

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
    return <div className="container mx-auto p-8 text-center text-ink-500">Caricamento...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-8 text-center">
        <p className="text-ink-500 text-lg">Accesso riservato agli amministratori.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
      <AdminSidebar />
      <main>{children}</main>
    </div>
  );
}

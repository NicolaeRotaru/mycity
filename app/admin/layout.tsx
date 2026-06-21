'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from '@/components/hooks/useProfile';
import { LoadingState } from '@/components/ui/LoadingState';
import AdminSidebar, { AdminMobileTopbar } from '@/components/admin/AdminSidebar';

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

  // Cockpit admin (design system v2): sidebar scura su desktop, contenuto a piena
  // larghezza su mobile (dove resta la MobileTabBar admin). Navbar e Footer globali
  // sono nascosti su /admin per dare lo shell standalone del mockup.
  return (
    <div className="min-h-screen bg-cream-100 md:grid md:grid-cols-[248px_1fr]">
      <AdminSidebar />
      <div className="min-w-0">
        <AdminMobileTopbar />
        <div className="px-4 py-6 sm:px-6 md:p-7">
          <div className="mx-auto w-full max-w-[1080px] pb-24 md:pb-0">{children}</div>
        </div>
      </div>
    </div>
  );
}

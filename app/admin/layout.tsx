'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from '@/components/hooks/useProfile';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import AdminSidebar, { AdminMobileTopbar } from '@/components/admin/AdminSidebar';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { profile, isAuthenticated, isLoading, isError, refetch } = useProfile();
  const isAdmin = profile?.role === 'admin';
  // 17/11/2026 (R01-013) — Un profilo che non si è letto (guasto, o lettura in pausa senza rete)
  // non è «un altro ruolo»: il ruolo si giudica solo su un profilo letto davvero, come in /seller e
  // /rider. Non allarga l'accesso: senza profilo letto il cockpit non si apre, si offre «Riprova».
  const profiloNonLetto = isAuthenticated && !profile;

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/sign-in');
    } else if (!profiloNonLetto && !isAdmin) {
      router.replace('/');
    }
  }, [isAuthenticated, isAdmin, profiloNonLetto, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return <LoadingState />;
  }

  if (profiloNonLetto) {
    return (
      <ErrorState
        title="Non riesco a leggere i dati del tuo account"
        description={
          isError
            ? 'La lettura non è riuscita: riprova fra un momento.'
            : 'Sembra che manchi la connessione: riprova appena torna la rete.'
        }
        onRetry={refetch ? () => refetch() : undefined}
      />
    );
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

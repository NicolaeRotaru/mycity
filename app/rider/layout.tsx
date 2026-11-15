'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from '@/components/hooks/useProfile';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import RiderShell from '@/components/rider/RiderShell';

export default function RiderLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { profile, isAuthenticated, isLoading, isRider, isAdmin, isError, refetch } = useProfile();
  const allowed = isRider || isAdmin;
  // 14/11/2026 (R19-023, giro di correzione) — Un profilo che non si è letto (guasto, oppure
  // lettura in pausa senza rete) non è «un altro tipo di account»: al fattorino si diceva
  // «Accesso riservato ai rider» e lo si mandava alla home. Il ruolo si giudica solo su un
  // profilo letto davvero, come nel layout del negozio; altrimenti si offre «Riprova».
  const profiloNonLetto = isAuthenticated && !profile;

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/sign-in?returnTo=/rider');
    } else if (!profiloNonLetto && !allowed) {
      router.replace('/');
    }
  }, [isAuthenticated, allowed, profiloNonLetto, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return <LoadingState />;
  }

  if (profiloNonLetto) {
    return (
      <ErrorState
        title="Non riesco a leggere i dati del tuo account"
        description={
          isError
            ? 'La lettura non è riuscita. Non vuol dire che il tuo account da rider non ci sia più: riprova fra un momento.'
            : 'Sembra che manchi la connessione. Non vuol dire che il tuo account da rider non ci sia più: riprova appena torna la rete.'
        }
        onRetry={refetch ? () => refetch() : undefined}
      />
    );
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

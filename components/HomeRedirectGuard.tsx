'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useProfile } from './hooks/useProfile';

/**
 * Reindirizza seller, rider e admin alla loro dashboard quando atterrano
 * sulla homepage del marketplace. Loro hanno una "home" diversa.
 *
 * Eccezione: se l'URL contiene ?as=buyer (es. dalla voce di menu
 * "Home marketplace" della sezione "Come acquirente") l'utente vuole
 * esplicitamente navigare il marketplace come cliente, non redirigiamo.
 *
 * Componente invisibile, da montare in app/page.tsx.
 *
 * NOTA: useSearchParams() richiede Suspense in pagine staticamente
 * pre-renderizzate (Next 14). Lo wrappiamo qui internamente così il
 * consumer non se ne deve preoccupare.
 */
function GuardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isSeller, isRider, isAdmin, isLoading } = useProfile();
  const asBuyer = searchParams.get('as') === 'buyer';

  useEffect(() => {
    if (isLoading) return;
    if (asBuyer) return; // opt-out esplicito → resta sulla home pubblica
    if (isAdmin)  { router.replace('/admin'); return; }
    if (isSeller) { router.replace('/seller/dashboard'); return; }
    if (isRider)  { router.replace('/rider'); return; }
  }, [isLoading, isSeller, isRider, isAdmin, asBuyer, router]);

  return null;
}

export default function HomeRedirectGuard() {
  return (
    <Suspense fallback={null}>
      <GuardInner />
    </Suspense>
  );
}

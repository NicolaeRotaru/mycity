'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useProfile } from './hooks/useProfile';

/**
 * Reindirizza seller, rider e admin alla loro dashboard quando atterrano
 * sulla homepage del marketplace. Loro hanno una "home" diversa.
 *
 * Eccezione: ?as=buyer (dal menu "Home marketplace") = l'utente vuole
 * esplicitamente navigare il marketplace come cliente → niente redirect.
 *
 * Anti-flash: finché non sappiamo il ruolo di un utente loggato, copriamo la
 * pagina con un overlay di caricamento, così chi verrà reindirizzato NON vede
 * per un attimo la home del buyer. Gli utenti anonimi vedono subito la home.
 */
function GuardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isSeller, isRider, isAdmin, isLoading } = useProfile();
  const asBuyer = searchParams.get('as') === 'buyer';

  // Sessione nota subito da storage (no rete) → decide se mostrare l'overlay.
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
  }, []);

  useEffect(() => {
    if (isLoading || asBuyer) return;
    if (isAdmin)  { router.replace('/admin'); return; }
    if (isSeller) { router.replace('/seller/dashboard'); return; }
    if (isRider)  { router.replace('/rider'); return; }
  }, [isLoading, isSeller, isRider, isAdmin, asBuyer, router]);

  // Opt-out o utente anonimo → mostra subito la home pubblica.
  if (asBuyer || hasSession === false) return null;

  const resolving = hasSession === null || isLoading;
  const willRedirect = isSeller || isRider || isAdmin;
  // Buyer loggato e ruolo risolto → mostra la home.
  if (!resolving && !willRedirect) return null;

  // Sessione presente ma ruolo non ancora confermato buyer → overlay.
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-cream-100">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-300 border-t-primary-700" />
        <p className="text-sm font-semibold text-ink-500">Carico la tua area…</p>
      </div>
    </div>
  );
}

export default function HomeRedirectGuard() {
  return (
    <Suspense fallback={null}>
      <GuardInner />
    </Suspense>
  );
}

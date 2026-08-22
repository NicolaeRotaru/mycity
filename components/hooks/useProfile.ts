'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { identify, resetUser } from '@/lib/analytics/posthog';
import { setSentryUser } from '@/lib/analytics/sentry';
import { queryKeys } from '@/lib/queries/keys';

export type Role = 'buyer' | 'seller' | 'rider' | 'admin' | 'pending_approval';

export type Profile = {
  id: string;
  role: Role;
  is_approved: boolean;
  store_name: string | null;
  store_logo: string | null;
  full_name: string | null;
  email: string | null;
  subscription_status: string | null;
};

/**
 * 22/8/2026 — NOVANTASEI SCHEDE, NOVANTASEI VERIFICHE DELL'UTENTE.
 *
 * Ogni scheda prodotto monta questo aggancio, e ognuna faceva per conto suo una
 * `supabase.auth.getUser()` — che non e' una lettura da memoria: e' una
 * chiamata di rete al servizio di autenticazione. Una griglia da novantasei
 * prodotti apriva novantasei chiamate, tutte per sapere la stessa identica cosa
 * sulla stessa identica persona. E ognuna apriva anche il proprio ascolto dei
 * cambi di sessione.
 *
 * Il profilo era gia' condiviso (una `useQuery` con la sua chiave). Quello che
 * mancava era condividere il passo PRIMA: chi sono.
 *
 * Qui la domanda si fa una volta sola per tutta la pagina, e l'ascolto dei cambi
 * di sessione e' uno solo: le schede si iscrivono a quello. La forma
 * dell'aggancio non cambia — nessuna pagina va toccata.
 */
type StatoAuth = { userId: string | null; userEmail: string | null; pronto: boolean };

let statoCondiviso: StatoAuth = { userId: null, userEmail: null, pronto: false };
let primaDomanda: Promise<void> | null = null;
let ascoltoAperto = false;
const iscritti = new Set<(s: StatoAuth) => void>();

function aggiorna(nuovo: StatoAuth) {
  statoCondiviso = nuovo;
  for (const avvisa of iscritti) avvisa(nuovo);
}

function apriAscolto() {
  if (ascoltoAperto) return;
  ascoltoAperto = true;
  supabase.auth.onAuthStateChange((event, session) => {
    const uid = session?.user?.id ?? null;
    const em = session?.user?.email ?? null;
    aggiorna({ userId: uid, userEmail: em, pronto: true });
    if (event === 'SIGNED_IN' && uid) { identify(uid); setSentryUser(uid, em ?? undefined); }
    if (event === 'SIGNED_OUT') { resetUser(); }
  });
}

function chiediChiSono(): Promise<void> {
  if (!primaDomanda) {
    primaDomanda = supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      const em = data.user?.email ?? null;
      aggiorna({ userId: uid, userEmail: em, pronto: true });
      // #220 — a PostHog va solo l'identificativo. L'email e' un dato personale
      // e PostHog di norma sta negli Stati Uniti: l'indirizzo non esce di qui.
      // Sentry resta con l'email perche' li' e' dichiarato e con conservazione
      // limitata, ed e' il posto dove serve per ricontattare chi ha visto l'errore.
      if (uid) { identify(uid); setSentryUser(uid, em ?? undefined); }
    }).catch(() => {
      aggiorna({ userId: null, userEmail: null, pronto: true });
    });
  }
  return primaDomanda;
}

export const useProfile = () => {
  const [stato, setStato] = useState<StatoAuth>(statoCondiviso);

  useEffect(() => {
    const avvisa = (s: StatoAuth) => setStato(s);
    iscritti.add(avvisa);
    apriAscolto();
    void chiediChiSono();
    // Se la risposta era gia' arrivata prima che questa scheda si montasse,
    // qui la si prende senza chiedere niente a nessuno.
    if (statoCondiviso.pronto) setStato(statoCondiviso);
    return () => { iscritti.delete(avvisa); };
  }, []);

  const userId = stato.userId;
  const userEmail = stato.userEmail;
  const authChecked = stato.pronto;

  const query = useQuery({
    queryKey: queryKeys.profile.authByUser(userId ?? ''),
    queryFn: async (): Promise<Profile | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, is_approved, store_name, store_logo, full_name, subscription_status')
        .eq('id', userId)
        .single();
      if (error) return null;
      return { ...data, email: userEmail };
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
  });

  const profile = query.data ?? null;
  const role = profile?.role;
  const isAuthenticated = !!userId;

  return {
    profile,
    userEmail,
    isLoading: !authChecked || (isAuthenticated && query.isLoading),
    isAuthenticated,
    isBuyer: role === 'buyer',
    isSeller: role === 'seller',
    isRider: role === 'rider',
    isAdmin: role === 'admin',
  };
};

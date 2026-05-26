'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Gift, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useProfile } from './hooks/useProfile';

const DISMISS_KEY = 'mc_welcome_dismissed';

/**
 * Banner verde sopra alla home: appare solo per buyer loggati che
 *  - hanno il welcome bonus (loyalty_transaction reason='signup_bonus')
 *  - non hanno ancora fatto nessun ordine
 *  - non l'hanno chiuso manualmente (dismiss in localStorage)
 *
 * Sparisce per sempre dopo il primo ordine completato o quando viene
 * chiuso con la X.
 */
// Welcome credit scade 7 giorni dopo il signup → leva urgenza CRO
// Esperti: Behavioral Scientist: "Senza countdown, urgenza zero → conversion -25%"
const WELCOME_VALID_DAYS = 7;

export default function WelcomeCreditBanner() {
  const { isAuthenticated, isBuyer, profile } = useProfile();
  const [show, setShow] = useState(false);
  const [points, setPoints] = useState(0);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !isBuyer || !profile?.id) return;
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;

    (async () => {
      // Controlla che abbia il signup_bonus
      const { data: bonus } = await supabase
        .from('loyalty_transactions')
        .select('id, delta, created_at')
        .eq('user_id', profile.id)
        .eq('reason', 'signup_bonus')
        .maybeSingle();
      if (!bonus) return;

      // Controlla che NON abbia ancora ordini
      const { count } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id);
      if ((count ?? 0) > 0) return;

      // Calcola giorni rimanenti
      const signupTs = bonus.created_at ? new Date(bonus.created_at).getTime() : Date.now();
      const expiresAt = signupTs + WELCOME_VALID_DAYS * 86_400_000;
      const remaining = Math.ceil((expiresAt - Date.now()) / 86_400_000);
      if (remaining <= 0) return; // expired
      setDaysLeft(remaining);

      // Recupera saldo punti corrente
      const { data: account } = await supabase
        .from('loyalty_accounts')
        .select('points_balance')
        .eq('user_id', profile.id)
        .maybeSingle();

      setPoints(account?.points_balance ?? bonus.delta);
      setShow(true);
    })().catch(() => { /* noop */ });
  }, [isAuthenticated, isBuyer, profile?.id]);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="relative bg-gradient-to-r from-olive-500 via-olive-600 to-primary-600 text-white animate-slide-down">
      <div className="container mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 justify-center text-sm sm:text-base">
        <Gift size={20} strokeWidth={2.4} className="shrink-0 text-accent-300" />
        <p className="text-center">
          <strong>Benvenuto!</strong> Hai <strong>€5 di sconto</strong>{' '}
          {daysLeft !== null && (
            <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs font-bold">
              scade tra {daysLeft} {daysLeft === 1 ? 'giorno' : 'giorni'}
            </span>
          )}
          {' '}— usali al primo ordine.{' '}
          <Link href="/search" className="underline font-semibold hover:text-accent-300">Inizia ora →</Link>
        </p>
        <button
          onClick={dismiss}
          aria-label="Chiudi"
          className="shrink-0 p-1 hover:bg-white/15 rounded-full transition-colors"
        >
          <X size={16} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

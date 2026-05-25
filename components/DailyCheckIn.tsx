'use client';

import { useEffect, useState } from 'react';
import { Flame, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { useProfile } from './hooks/useProfile';
import { touchLoyaltyStreak } from '@/lib/loyalty';

const LAST_CHECKIN_KEY = 'mc_last_checkin';

/**
 * Effettua il check-in giornaliero al primo caricamento dell'app per
 * l'utente autenticato. Avviene UNA volta al giorno (controllo via
 * localStorage + RPC server-side idempotente).
 *
 * Mostra un toast con "X giorni di fila!" e bonus se è una milestone.
 * Non rende nessun markup visibile.
 */
export default function DailyCheckIn() {
  const { isAuthenticated, isLoading } = useProfile();
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || isLoading || done) return;
    if (typeof window === 'undefined') return;

    const today = new Date().toISOString().slice(0, 10);
    const last = localStorage.getItem(LAST_CHECKIN_KEY);
    if (last === today) {
      setDone(true);
      return;
    }

    // Aspetta che la session sia certa
    const id = setTimeout(async () => {
      const result = await touchLoyaltyStreak();
      if (!result) return;
      localStorage.setItem(LAST_CHECKIN_KEY, today);
      setDone(true);

      // Toast solo se è un nuovo giorno (no rumore al refresh)
      if (!result.alreadyToday && result.streak > 0) {
        const isMilestone = result.bonus > 0;
        toast.custom(
          () => (
            <div className="bg-white border border-cream-300 rounded-2xl shadow-warm-lg p-4 flex items-start gap-3 max-w-sm">
              <div className={`text-3xl ${isMilestone ? 'animate-heart-beat' : ''}`}>
                {isMilestone ? '🏆' : '🔥'}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-ink-900">
                  {result.streak === 1
                    ? 'Bentornato!'
                    : isMilestone
                      ? `${result.streak} giorni di fila!`
                      : `Streak: ${result.streak} giorni`}
                </p>
                <p className="text-xs text-ink-600 mt-0.5">
                  {isMilestone
                    ? `Hai guadagnato +${result.bonus} punti per la costanza`
                    : result.streak >= 3
                      ? 'Continua così, ogni 7 giorni guadagni bonus!'
                      : 'Visita ogni giorno per accumulare bonus.'}
                </p>
              </div>
            </div>
          ),
          { duration: 5000 }
        );
      }
    }, 1500);

    return () => clearTimeout(id);
  }, [isAuthenticated, isLoading, done]);

  return null;
}

// Esportiamo anche i due icon componenti per usarli nella UI di profilo
export { Flame, Trophy };

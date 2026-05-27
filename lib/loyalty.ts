/**
 * Helper client-side per il sistema loyalty.
 * Le RPC sono SECURITY DEFINER su DB e validano auth.uid().
 */

import { supabase } from '@/lib/supabase/client';

export type LoyaltyTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export type LoyaltyAccount = {
  user_id: string;
  points_balance: number;
  lifetime_earned: number;
  tier: LoyaltyTier;
  streak_days: number;
  last_visit_date: string | null;
  longest_streak: number;
};

export const TIER_META: Record<LoyaltyTier, { label: string; emoji: string; threshold: number; color: string }> = {
  bronze:   { label: 'Bronzo',   emoji: '🥉', threshold: 0,    color: 'text-amber-700' },
  silver:   { label: 'Argento',  emoji: '🥈', threshold: 500,  color: 'text-ink-500' },
  gold:     { label: 'Oro',      emoji: '🥇', threshold: 2000, color: 'text-accent-600' },
  platinum: { label: 'Platino',  emoji: '💎', threshold: 5000, color: 'text-primary-700' },
};

export const POINTS_PER_EURO = 1;
export const POINTS_REDEEM_RATE = 100; // 100 punti = €5
export const POINTS_REDEEM_VALUE_CENTS = 500;

/**
 * Centesimi → punti loyalty (1pt per €1 speso, arrotondato per difetto)
 */
export function eurosCentsToPoints(cents: number): number {
  return Math.floor(cents / 100) * POINTS_PER_EURO;
}

export function pointsToEurValue(points: number): number {
  return Math.floor(points / POINTS_REDEEM_RATE) * (POINTS_REDEEM_VALUE_CENTS / 100);
}

/**
 * Carica saldo + tier dell'utente corrente. Crea automaticamente l'account
 * via touch_loyalty_streak se non esiste.
 */
export async function fetchLoyaltyAccount(): Promise<LoyaltyAccount | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('loyalty_accounts')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  return data as LoyaltyAccount | null;
}

/**
 * "Check-in" giornaliero: chiama l'RPC touch_loyalty_streak() che incrementa
 * la streak se l'utente ha visitato ieri (+1), resetta a 1 se ha saltato un
 * giorno, premia con punti bonus a 7/30/100 giorni.
 *
 * Idempotente: chiamabile più volte nello stesso giorno (l'RPC restituisce
 * `already_today: true` senza modificare nulla).
 */
type LoyaltyStreakRpc = { streak?: number; bonus?: number; already_today?: boolean };

export async function touchLoyaltyStreak(): Promise<{ streak: number; bonus: number; alreadyToday: boolean } | null> {
  const { data, error } = await supabase.rpc('touch_loyalty_streak');
  if (error || !data) return null;
  const d = data as LoyaltyStreakRpc;
  return {
    streak: d.streak ?? 0,
    bonus: d.bonus ?? 0,
    alreadyToday: !!d.already_today,
  };
}

/**
 * Mappa tier corrente al prossimo livello (per progress bar in UI)
 */
export function nextTier(lifetime: number, current: LoyaltyTier): { tier: LoyaltyTier | null; remaining: number } {
  const order: LoyaltyTier[] = ['bronze', 'silver', 'gold', 'platinum'];
  const idx = order.indexOf(current);
  const next = order[idx + 1] ?? null;
  if (!next) return { tier: null, remaining: 0 };
  return { tier: next, remaining: Math.max(0, TIER_META[next].threshold - lifetime) };
}

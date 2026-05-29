'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/errors';

const RIDER_STRIPE_STATUS = ['rider', 'stripe-status'] as const;

type RiderStripe = {
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean | null;
  stripe_payouts_enabled: boolean | null;
};

async function getToken(): Promise<string | undefined> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token;
}

/**
 * Onboarding/stato Stripe Connect (IBAN) per il RIDER, sulla pagina Guadagni.
 * Riceve i compensi di consegna sull'IBAN collegato. Al ritorno dall'onboarding
 * (?stripe=connected) risincronizza lo stato da Stripe.
 */
export default function RiderConnectButton() {
  const qc = useQueryClient();
  const [redirecting, setRedirecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: RIDER_STRIPE_STATUS,
    queryFn: async (): Promise<RiderStripe | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from('profiles')
        .select('stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled')
        .eq('id', user.id)
        .single();
      return (data as RiderStripe) ?? null;
    },
  });

  const refreshStatus = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/stripe/connect/refresh-status', {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      await qc.invalidateQueries({ queryKey: RIDER_STRIPE_STATUS });
      if (!silent) {
        if (data?.payouts_enabled) toast.success('IBAN attivo: riceverai i compensi.');
        else toast('Stato aggiornato. Se risulta in attesa, completa la verifica.', { icon: '🔄' });
      }
    } catch (err) {
      if (!silent) toast.error(friendlyError(err));
    } finally {
      if (!silent) setRefreshing(false);
    }
  };

  // Al ritorno dall'onboarding: sincronizza una volta.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    if (p.get('stripe') === 'connected') {
      refreshStatus(true);
      window.history.replaceState({}, '', '/rider/earnings');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startOnboarding = async () => {
    setRedirecting(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/stripe/connect/rider-onboarding', {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok || !data?.url) throw new Error(data?.error?.message ?? data?.error ?? 'Errore avvio onboarding');
      window.location.assign(data.url as string);
    } catch (err) {
      toast.error(friendlyError(err));
      setRedirecting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-ink-500">
        <Loader2 size={16} className="animate-spin" /> Verifica IBAN…
      </div>
    );
  }

  const isActive = !!status?.stripe_charges_enabled && !!status?.stripe_payouts_enabled;
  const isPending = !!status?.stripe_account_id && !isActive;

  if (isActive) {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg border border-olive-300 bg-olive-50 px-4 py-2 text-sm font-semibold text-olive-800">
        <CheckCircle2 size={16} /> IBAN attivo · ricevi i compensi
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={startOnboarding}
        disabled={redirecting}
        className="inline-flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-accent-600 disabled:opacity-50"
      >
        {redirecting ? <Loader2 size={16} className="animate-spin" /> : <Banknote size={16} />}
        {isPending ? 'Completa configurazione IBAN' : 'Collega IBAN per i compensi'}
      </button>
      {isPending && (
        <button
          type="button"
          onClick={() => refreshStatus(false)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-accent-300 px-3 py-2.5 text-sm font-semibold text-accent-700 transition-colors hover:bg-accent-50 disabled:opacity-50"
        >
          {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Aggiorna stato
        </button>
      )}
    </div>
  );
}

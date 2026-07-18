'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CheckCircle2, AlertCircle, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { trackSellerOnboardingStarted } from '@/lib/analytics/events';

/**
 * Bottone onboarding Stripe Connect per seller.
 *
 * Stato derivato da profiles (stripe_account_id, stripe_charges_enabled,
 * stripe_payouts_enabled). Al click chiama POST /api/stripe/connect/onboarding
 * che crea/riusa l'account Express e ritorna l'URL hosted di onboarding
 * Stripe (KYC + IBAN + TOS). L'utente viene reindirizzato lì.
 *
 * Sostituisce il vecchio link rotto "Configura IBAN → /profile/settings".
 */
export default function StripeConnectButton() {
  const [redirecting, setRedirecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: queryKeys.seller.stripeStatus,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from('profiles')
        .select('stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, approval_status')
        .eq('id', user.id)
        .single();
      return data as {
        stripe_account_id: string | null;
        stripe_charges_enabled: boolean | null;
        stripe_payouts_enabled: boolean | null;
        approval_status: string | null;
      } | null;
    },
  });

  const startOnboarding = async () => {
    setRedirecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/stripe/connect/onboarding', {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        throw new Error(data?.error?.message ?? data?.error ?? 'Errore avvio onboarding');
      }
      trackSellerOnboardingStarted();
      window.location.assign(data.url as string);
    } catch (err) {
      toast.error(friendlyError(err));
      setRedirecting(false);
    }
  };

  // Fallback se il webhook account.updated non ha aggiornato i flag:
  // rilegge lo stato da Stripe lato server e ricarica la query.
  const refreshStatus = async () => {
    setRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/stripe/connect/refresh-status', {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? data?.error ?? 'Errore aggiornamento stato');
      await queryClient.invalidateQueries({ queryKey: queryKeys.seller.stripeStatus });
      if (data?.charges_enabled && data?.payouts_enabled) {
        toast.success('Pagamenti attivati!');
      } else if (Array.isArray(data?.currently_due) && data.currently_due.length > 0) {
        toast('Mancano ancora verifiche su Stripe: completa l\'onboarding.', { icon: <AlertTriangle size={16} /> });
      } else {
        toast('Stato aggiornato. Se risulta ancora in attesa, riprova tra poco.', { icon: <RefreshCw size={16} /> });
      }
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setRefreshing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-ink-500">
        <Loader2 size={16} className="animate-spin" /> Verifica stato pagamenti…
      </div>
    );
  }

  const isActive = !!status?.stripe_charges_enabled && !!status?.stripe_payouts_enabled;
  const isPendingVerification = !!status?.stripe_account_id && !isActive;
  const kycApproved = status?.approval_status === 'approved';

  // Pagamenti già attivi
  if (isActive) {
    return (
      <div className="inline-flex items-center gap-2 bg-olive-50 border border-olive-300 text-olive-800 px-4 py-2 rounded-lg text-sm font-semibold">
        <CheckCircle2 size={16} /> Pagamenti attivi · ricevi bonifici sul tuo IBAN
      </div>
    );
  }

  // KYC MyCity non ancora approvato → non può avviare Connect
  if (!kycApproved) {
    return (
      <div className="inline-flex items-center gap-2 bg-cream-100 border border-cream-300 text-ink-600 px-4 py-2 rounded-lg text-sm">
        <AlertCircle size={16} /> Completa prima la verifica del negozio per attivare i pagamenti
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={startOnboarding}
        disabled={redirecting}
        className="inline-flex items-center gap-2 bg-primary-700 hover:bg-primary-800 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap transition-colors"
      >
        {redirecting ? <Loader2 size={16} className="animate-spin" /> : <Banknote size={16} />}
        {isPendingVerification ? 'Completa configurazione pagamenti' : 'Collega conto per ricevere pagamenti'}
      </button>
      {isPendingVerification && (
        <button
          type="button"
          onClick={refreshStatus}
          disabled={refreshing}
          title="Hai già completato l'onboarding su Stripe? Rileggi lo stato."
          className="inline-flex items-center gap-2 border border-primary-300 text-primary-700 hover:bg-primary-50 disabled:opacity-50 px-3 py-2.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors"
        >
          {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Aggiorna stato
        </button>
      )}
    </div>
  );
}

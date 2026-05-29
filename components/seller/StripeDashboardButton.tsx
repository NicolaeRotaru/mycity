'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

/**
 * Bottone "Gestisci su Stripe" per seller con Connect già attivo.
 *
 * Apre la Dashboard Express ospitata da Stripe (saldo, payout reali,
 * IBAN, documenti d'identità/KYC, dati fiscali) tramite login link
 * monouso generato da POST /api/stripe/connect/login. L'utente viene
 * reindirizzato lì.
 *
 * Si renderizza SOLO quando i pagamenti sono attivi (charges + payouts):
 * prima dell'onboarding non esiste una dashboard da aprire e il flusso
 * resta su <StripeConnectButton>. Condivide la stessa queryKey di
 * StripeConnectButton, quindi React Query deduplica: nessuna fetch extra.
 */
export default function StripeDashboardButton() {
  const [redirecting, setRedirecting] = useState(false);

  const { data: status } = useQuery({
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

  const openDashboard = async () => {
    setRedirecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/stripe/connect/login', {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        throw new Error(data?.error?.message ?? data?.error ?? 'Errore apertura dashboard');
      }
      window.location.assign(data.url as string);
    } catch (err) {
      toast.error(friendlyError(err));
      setRedirecting(false);
    }
  };

  // Mostra solo a pagamenti attivi: prima non c'è una dashboard da aprire.
  const isActive = !!status?.stripe_charges_enabled && !!status?.stripe_payouts_enabled;
  if (!isActive) return null;

  return (
    <button
      type="button"
      onClick={openDashboard}
      disabled={redirecting}
      className="inline-flex items-center gap-2 bg-white hover:bg-cream-100 border border-olive-300 text-olive-800 disabled:opacity-50 px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap transition-colors"
    >
      {redirecting ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
      Gestisci pagamenti e IBAN su Stripe
    </button>
  );
}

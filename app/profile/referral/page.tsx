'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, Clipboard, MessageCircle, Mail, Lightbulb, Trophy } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

export default function ReferralPage() {
  const [copied, setCopied] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: queryKeys.referrals.mine,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data } = await supabase
        .from('profiles')
        .select('referral_code, full_name')
        .eq('id', user.id)
        .single();
      return data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: queryKeys.referrals.stats(profile?.referral_code ?? ''),
    enabled: !!profile?.referral_code,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { total: 0, rewarded: 0, earned: 0 };
      const { data: referrals } = await supabase
        .from('referrals')
        .select('reward_amount, rewarded')
        .eq('referrer_id', user.id);
      const list = referrals ?? [];
      return {
        total: list.length,
        rewarded: list.filter((r) => r.rewarded).length,
        earned: list
          .filter((r) => r.rewarded)
          .reduce((s, r) => s + Number(r.reward_amount), 0),
      };
    },
  });

  if (isLoading || !profile) return <LoadingState />;

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://mycity.it';
  const inviteLink = `${baseUrl}/sign-up?ref=${profile.referral_code}`;
  const shareText = `Iscriviti a MyCity Piacenza, il marketplace dei negozi locali. Usa il mio codice ${profile.referral_code} e abbiamo entrambi €5 di sconto!\n${inviteLink}`;

  const copy = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success('Link copiato!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
      <div>
        <Link href="/profile" className="text-sm text-primary-700 hover:underline">← Profilo</Link>
        <h1 className="text-2xl font-bold text-ink-900 mt-1">Invita amici, guadagnate entrambi €5</h1>
        <p className="text-sm text-ink-500">Condividi il tuo codice: tu ricevi €5 di credito, anche il tuo amico riceve €5 di sconto sul primo ordine.</p>
        {/* 🟡-21: la pagina leaderboard era orfana (nessun link la raggiungeva). */}
        <Link
          href="/profile/referral/leaderboard"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline"
        >
          <Trophy size={16} aria-hidden /> Classifica inviti
        </Link>
      </div>

      {/* CODICE */}
      <div className="bg-gradient-to-br from-primary-600 to-secondary-600 text-white rounded-2xl p-6 text-center">
        <p className="text-xs uppercase tracking-widest text-primary-100 mb-2">Il tuo codice</p>
        <p className="font-mono text-4xl font-extrabold tracking-wider mb-4">{profile.referral_code}</p>
        <button
          onClick={copy}
          className="inline-flex items-center gap-2 bg-white text-primary-800 hover:bg-primary-50 px-6 py-2.5 rounded-lg font-bold"
        >
          {copied ? (
            <>
              <Check size={18} className="text-primary-800" aria-hidden />
              Copiato!
            </>
          ) : (
            <>
              <Clipboard size={18} className="text-primary-800" aria-hidden />
              Copia link invito
            </>
          )}
        </button>
      </div>

      {/* SHARE */}
      <div className="bg-white border rounded-xl p-5 space-y-3">
        <h2 className="font-bold text-ink-900">Condividi</h2>
        <div className="grid grid-cols-2 gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-olive-500 hover:bg-olive-600 text-white px-4 py-2.5 rounded-lg font-semibold text-sm text-center"
          >
            <MessageCircle size={16} className="text-white" aria-hidden />
            WhatsApp
          </a>
          <a
            href={`mailto:?subject=${encodeURIComponent('Iscriviti a MyCity Piacenza')}&body=${encodeURIComponent(shareText)}`}
            className="inline-flex items-center justify-center gap-2 bg-ink-700 hover:bg-ink-800 text-white px-4 py-2.5 rounded-lg font-semibold text-sm text-center"
          >
            <Mail size={16} className="text-white" aria-hidden />
            Email
          </a>
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-3xl font-bold font-serif text-primary-700">{stats?.total ?? 0}</p>
          <p className="text-xs text-ink-500 uppercase tracking-wide mt-1">Invitati</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-3xl font-bold font-serif text-accent-600">{stats?.rewarded ?? 0}</p>
          <p className="text-xs text-ink-500 uppercase tracking-wide mt-1">Confermati</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold font-serif text-olive-600">{formatPrice(stats?.earned ?? 0)}</p>
          <p className="text-xs text-ink-500 uppercase tracking-wide mt-1">Guadagnati</p>
        </div>
      </div>

      <div className="bg-accent-50 border border-accent-200 rounded-xl p-4 text-sm text-accent-900 flex items-start gap-2">
        <Lightbulb size={18} className="text-accent-500 shrink-0 mt-0.5" aria-hidden />
        <span><strong>Come funziona</strong>: il tuo amico si iscrive col tuo codice → fa il primo ordine → tu ricevi €5 di credito, lui paga €5 in meno.</span>
      </div>
    </div>
  );
}

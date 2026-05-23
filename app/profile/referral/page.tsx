'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';

export default function ReferralPage() {
  const [copied, setCopied] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['my-referral'],
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
    queryKey: ['referral-stats', profile?.referral_code],
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

  if (isLoading || !profile) return <div className="container mx-auto p-8 text-center text-gray-500">Caricamento...</div>;

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://mycity.it';
  const inviteLink = `${baseUrl}/sign-up?ref=${profile.referral_code}`;
  const shareText = `Iscriviti a MyCity Piacenza, il marketplace dei negozi locali. Usa il mio codice ${profile.referral_code} e abbiamo entrambi €5 di sconto! 👇\n${inviteLink}`;

  const copy = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success('Link copiato!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
      <div>
        <Link href="/profile" className="text-sm text-indigo-600 hover:underline">← Profilo</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Invita amici, guadagnate entrambi €5</h1>
        <p className="text-sm text-gray-500">Condividi il tuo codice: tu ricevi €5 di credito, anche il tuo amico riceve €5 di sconto sul primo ordine.</p>
      </div>

      {/* CODICE */}
      <div className="bg-gradient-to-br from-indigo-600 to-purple-600 text-white rounded-2xl p-6 text-center">
        <p className="text-xs uppercase tracking-widest text-indigo-200 mb-2">Il tuo codice</p>
        <p className="font-mono text-4xl font-extrabold tracking-wider mb-4">{profile.referral_code}</p>
        <button
          onClick={copy}
          className="bg-white text-indigo-700 hover:bg-indigo-50 px-6 py-2.5 rounded-lg font-bold"
        >
          {copied ? '✓ Copiato!' : '📋 Copia link invito'}
        </button>
      </div>

      {/* SHARE */}
      <div className="bg-white border rounded-xl p-5 space-y-3">
        <h2 className="font-bold text-gray-900">Condividi</h2>
        <div className="grid grid-cols-2 gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 rounded-lg font-semibold text-sm text-center"
          >
            💬 WhatsApp
          </a>
          <a
            href={`mailto:?subject=${encodeURIComponent('Iscriviti a MyCity Piacenza')}&body=${encodeURIComponent(shareText)}`}
            className="bg-gray-700 hover:bg-gray-800 text-white px-4 py-2.5 rounded-lg font-semibold text-sm text-center"
          >
            ✉️ Email
          </a>
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-indigo-600">{stats?.total ?? 0}</p>
          <p className="text-xs text-gray-500 uppercase tracking-wide mt-1">Invitati</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-amber-600">{stats?.rewarded ?? 0}</p>
          <p className="text-xs text-gray-500 uppercase tracking-wide mt-1">Confermati</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-emerald-600">{formatPrice(stats?.earned ?? 0)}</p>
          <p className="text-xs text-gray-500 uppercase tracking-wide mt-1">Guadagnati</p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
        💡 <strong>Come funziona</strong>: il tuo amico si iscrive col tuo codice → fa il primo ordine → tu ricevi €5 di credito, lui paga €5 in meno.
      </div>
    </div>
  );
}

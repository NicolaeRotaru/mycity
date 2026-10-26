'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Trophy, Crown, ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';
import { CLASSIFICA_INVITI_ACCESA } from '@/lib/funzioni-al-lancio';

type Entry = {
  user_id: string;
  full_name: string | null;
  store_name: string | null;
  total_referrals: number;
  converted_referrals: number;
};

function anonName(full: string | null, store: string | null): string {
  const name = store ?? full ?? 'Anonimo';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function ClassificaInviti() {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: queryKeys.referrals.leaderboard,
    queryFn: async (): Promise<Entry[]> => {
      const { data } = await supabase
        .from('referral_leaderboard')
        .select('user_id, full_name, store_name, total_referrals, converted_referrals')
        .limit(50);
      return (data ?? []) as Entry[];
    },
  });

  const monthLabel = new Date().toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl space-y-6">
      <div>
        <Link href="/profile/referral" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
          <ArrowLeft size={14} /> Referral
        </Link>
        <h1 className="text-3xl font-serif font-bold mt-2 text-ink-900 flex items-center gap-2">
          <Trophy size={28} className="text-accent-600" />
          Classifica Referral
        </h1>
        <p className="text-sm text-ink-500 mt-1">Chi ha portato più amici nel mese di <strong className="capitalize">{monthLabel}</strong>.</p>
      </div>

      {/* Classifica */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl skeleton" />)}</div>
      ) : entries.length === 0 ? (
        <div className="bg-white border border-cream-300 rounded-2xl p-12 text-center">
          <Trophy size={36} className="mx-auto text-ink-300 mb-3" />
          <p className="text-ink-600 font-medium">Classifica vuota</p>
          <p className="text-sm text-ink-400 mt-1">Sii il primo a invitare amici questo mese!</p>
        </div>
      ) : (
        <div className="bg-white border border-cream-300 rounded-2xl divide-y divide-cream-200 overflow-hidden shadow-warm">
          {entries.map((e, i) => {
            const rank = i + 1;
            return (
              <div key={e.user_id} className={`flex items-center gap-3 p-4 ${rank <= 3 ? 'bg-gradient-to-r from-accent-50 to-transparent' : ''}`}>
                <span className={`w-10 h-10 rounded-full flex items-center justify-center font-serif font-bold shrink-0 ${
                  rank === 1 ? 'bg-accent-500 text-ink-900' :
                  rank === 2 ? 'bg-ink-200 text-ink-800' :
                  rank === 3 ? 'bg-accent-300 text-accent-900' :
                               'bg-cream-100 text-ink-600'
                }`}>
                  {rank <= 3 ? <Crown size={18} /> : rank}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ink-900 truncate">{anonName(e.full_name, e.store_name)}</p>
                  <p className="text-xs text-ink-500">{e.converted_referrals} convertiti / {e.total_referrals} invitati</p>
                </div>
                <span className="text-lg font-bold text-primary-700 shrink-0">{e.converted_referrals}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-cream-50 border border-cream-300 rounded-2xl p-5 text-sm text-ink-700 space-y-2">
        <p><strong>Come funziona la classifica:</strong></p>
        <ul className="list-disc list-inside space-y-1 text-ink-600">
          <li>Conta solo il mese corrente (azzera ogni 1° del mese)</li>
          <li>Conta solo i referral <strong>convertiti</strong> (l'amico ha fatto almeno un ordine)</li>
        </ul>
      </div>
    </div>
  );
}

/**
 * Classifica degli inviti SPENTA al lancio (carta #209, firmata il 26/10/2026).
 * Prima diceva «i primi 3 vincono 100, 50 e 25 euro»: nessun pezzo del sito
 * pagava quei premi, e un premio a chi arriva primo è un concorso a premi
 * (DPR 430/2001) mai comunicato al Ministero. I premi sono tolti anche dalla
 * classifica vera; da spenta non legge nemmeno la vista.
 */
export default function ReferralLeaderboardPage() {
  if (!CLASSIFICA_INVITI_ACCESA) return <ClassificaSpenta />;
  return <ClassificaInviti />;
}

function ClassificaSpenta() {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl space-y-4">
      <Link href="/profile/referral" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft size={14} /> Invita un amico
      </Link>
      <h1 className="text-3xl font-serif font-bold text-ink-900">Classifica inviti</h1>
      <p className="text-sm text-ink-700">
        La classifica degli inviti non è attiva. Il credito per ogni amico che inviti resta quello scritto nella pagina «Invita un amico».
      </p>
    </div>
  );
}

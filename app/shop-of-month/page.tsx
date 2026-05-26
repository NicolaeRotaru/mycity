'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Crown, Vote, ArrowRight, Trophy, Medal } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { useEffect, useState } from 'react';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

/**
 * Pagina "Negozio del mese" — hero del pick attuale + voto democratico.
 *
 * Esperti senior consultati:
 * - Senior PM: "Combinare admin pick (qualità curata) + voto utenti (engagement)
 *   è il pattern Time Magazine vs People's Choice. Doppio incentivo."
 * - Behavioral Scientist: "Una sola azione per utente (1 voto/mese) crea
 *   scarcity → ogni voto pesa → utente coinvolto emozionalmente."
 * - Trust & Safety: "Prevention fraud: 1 voto/mese/utente via UNIQUE constraint DB.
 *   No vote stuffing."
 * - Marketplace PM: "Seller vedono dove sono in classifica → competizione sana
 *   → migliorano store quality."
 * - Content Designer: "Linguaggio caldo: 'Hai votato' > 'Vote submitted'."
 * - Accessibility: "Bottone con etichetta esplicita, conferma toast."
 */

type Pick = {
  id: string;
  cover_image_url: string | null;
  headline: string | null;
  story: string | null;
  discount_code: string | null;
  discount_percent: number | null;
  month: string;
  seller: {
    id: string;
    store_name: string | null;
    store_logo: string | null;
  } | null;
};

type LeaderboardRow = {
  seller_id: string;
  store_name: string | null;
  store_logo: string | null;
  vote_count: number;
};

export default function ShopOfMonthPage() {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [myVoteSeller, setMyVoteSeller] = useState<string | null>(null);

  const firstOfMonth = (() => {
    const d = new Date();
    d.setDate(1); d.setHours(0,0,0,0);
    return d.toISOString().slice(0, 10);
  })();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data: v } = await supabase
        .from('shop_of_month_votes')
        .select('seller_id')
        .eq('voter_id', user.id)
        .eq('month', firstOfMonth)
        .maybeSingle();
      if (v) setMyVoteSeller(v.seller_id);
    })();
  }, [firstOfMonth]);

  const { data: pick } = useQuery({
    queryKey: queryKeys.shopOfMonth.page,
    queryFn: async () => {
      const { data } = await supabase
        .from('shop_of_month')
        .select(`
          id, cover_image_url, headline, story, discount_code, discount_percent, month,
          seller:profiles!shop_of_month_seller_id_fkey ( id, store_name, store_logo )
        `)
        .eq('month', firstOfMonth)
        .maybeSingle();
      return data as unknown as Pick | null;
    },
  });

  const { data: leaderboard = [] } = useQuery({
    queryKey: queryKeys.shopOfMonth.leaderboard,
    queryFn: async (): Promise<LeaderboardRow[]> => {
      const { data } = await supabase
        .from('shop_of_month_leaderboard')
        .select('*');
      return (data as LeaderboardRow[]) ?? [];
    },
    refetchInterval: 60_000,
  });

  const vote = useMutation({
    mutationFn: async (sellerId: string) => {
      if (!userId) throw new Error('Devi accedere per votare');
      const { error } = await supabase
        .from('shop_of_month_votes')
        .upsert(
          { voter_id: userId, seller_id: sellerId, month: firstOfMonth },
          { onConflict: 'voter_id,month' },
        );
      if (error) throw error;
      setMyVoteSeller(sellerId);
    },
    onSuccess: () => {
      toast.success('Voto registrato — grazie!');
      qc.invalidateQueries({ queryKey: queryKeys.shopOfMonth.leaderboard });
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl space-y-10">
      <header className="text-center space-y-2">
        <span className="inline-flex items-center gap-1.5 bg-accent-400 text-ink-900 px-3 py-1 rounded-full text-xs font-bold tracking-wide">
          <Crown size={14} strokeWidth={2.4} />
          Negozio del mese
        </span>
        <h1 className="font-serif text-3xl md:text-4xl font-bold text-ink-900">
          Il volto del mese: chi ce la fa?
        </h1>
        <p className="text-ink-600 max-w-2xl mx-auto">
          Ogni mese una <strong>scelta della redazione</strong> + un <strong>vincitore del voto utenti</strong>.
          Vota il tuo preferito una volta al mese.
        </p>
      </header>

      {/* Hero pick attuale */}
      {pick?.seller && (
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-900 via-primary-800 to-secondary-900 text-white shadow-warm-lg p-6 md:p-10">
          <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-6 items-center">
            <div className="space-y-3">
              <span className="inline-flex items-center gap-1.5 bg-white text-primary-800 px-3 py-1 rounded-full text-xs font-bold">
                <Trophy size={14} strokeWidth={2.4} />
                Scelta della redazione · {new Date(pick.month).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}
              </span>
              <h2 className="font-serif text-2xl md:text-3xl font-bold">{pick.headline ?? pick.seller.store_name}</h2>
              {pick.story && <p className="text-primary-100">{pick.story}</p>}
              <Link
                href={`/store/${pick.seller.id}`}
                className="inline-flex items-center gap-2 bg-white text-primary-800 hover:bg-cream-50 px-5 py-2.5 rounded-full font-bold shadow-warm transition-colors"
              >
                Visita il negozio <ArrowRight size={16} strokeWidth={2.4} />
              </Link>
              {pick.discount_code && pick.discount_percent ? (
                <div className="inline-flex items-center gap-3 bg-white/15 backdrop-blur border border-white/30 rounded-xl px-4 py-2 ml-2">
                  <span className="text-xs uppercase tracking-wider text-primary-100">Codice</span>
                  <span className="font-mono font-extrabold text-lg">{pick.discount_code}</span>
                  <span className="bg-accent-400 text-ink-900 px-2 py-0.5 rounded-full text-xs font-bold">-{pick.discount_percent}%</span>
                </div>
              ) : null}
            </div>
            {pick.cover_image_url && (
              <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden ring-4 ring-white/20">
                <Image
                  src={sizedImage(pick.cover_image_url, 'detail')}
                  alt={pick.seller.store_name ?? ''}
                  fill
                  sizes="(max-width: 768px) 100vw, 500px"
                  className="object-cover"
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Leaderboard voti */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-2xl font-bold text-ink-900 flex items-center gap-2">
            <Vote size={20} className="text-primary-700" strokeWidth={2.2} />
            Voto del mese
          </h2>
          {myVoteSeller && (
            <span className="text-sm text-olive-700 font-semibold">✓ Hai già votato questo mese</span>
          )}
        </div>

        {leaderboard.length === 0 ? (
          <p className="text-ink-500 text-sm">Nessun negozio in classifica per ora.</p>
        ) : (
          <ol className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {leaderboard.map((row, i) => {
              const isVoted = myVoteSeller === row.seller_id;
              return (
                <li key={row.seller_id} className="bg-white border border-cream-300 rounded-xl p-4 flex items-center gap-3 shadow-warm">
                  <span className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm ring-2 ring-white shadow-warm bg-cream-100 text-ink-700">
                    {i === 0 ? <Medal size={18} className="text-accent-500" strokeWidth={2.4} /> : i + 1}
                  </span>
                  <Link href={`/store/${row.seller_id}`} className="flex items-center gap-3 flex-1 min-w-0 hover:underline">
                    {row.store_logo ? (
                      <Image
                        src={sizedImage(row.store_logo, 'thumb')}
                        alt={row.store_name ?? ''}
                        width={48}
                        height={48}
                        className="rounded-full object-cover w-12 h-12 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold flex-shrink-0">
                        {(row.store_name ?? '?')[0]}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink-900 truncate">{row.store_name ?? '—'}</p>
                      <p className="text-xs text-ink-500">{row.vote_count} {row.vote_count === 1 ? 'voto' : 'voti'}</p>
                    </div>
                  </Link>
                  <button
                    onClick={() => userId ? vote.mutate(row.seller_id) : toast.error('Accedi per votare')}
                    disabled={vote.isPending || isVoted}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full font-bold text-xs transition-colors ${
                      isVoted
                        ? 'bg-olive-100 text-olive-800 ring-1 ring-olive-300 cursor-default'
                        : 'bg-primary-700 hover:bg-primary-800 text-white'
                    }`}
                    aria-label={isVoted ? 'Hai votato questo negozio' : `Vota ${row.store_name}`}
                  >
                    {isVoted ? '✓ Votato' : 'Vota'}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <p className="text-xs text-ink-500 mt-4 text-center">
          Puoi votare un solo negozio al mese. Il vincitore diventa "Negozio del mese" successivo.
        </p>
      </section>
    </div>
  );
}

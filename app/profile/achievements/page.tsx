'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Trophy, Lock, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  points_reward: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  target_role: string;
  sort_order: number;
};

const TIER_BG: Record<string, string> = {
  bronze:   'from-accent-100 to-accent-50 border-accent-300',
  silver:   'from-ink-100 to-ink-50 border-ink-300',
  gold:     'from-accent-200 to-accent-100 border-accent-400',
  platinum: 'from-primary-200 to-primary-100 border-primary-400',
};

const TIER_TEXT: Record<string, string> = {
  bronze:   'text-accent-800',
  silver:   'text-ink-700',
  gold:     'text-accent-800',
  platinum: 'text-primary-800',
};

export default function AchievementsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/sign-in?returnTo=/profile/achievements'); return; }
      setUserId(data.user.id);
    });
  }, [router]);

  const { data: achievements = [] } = useQuery({
    queryKey: ['achievements-all'],
    queryFn: async (): Promise<Achievement[]> => {
      const { data } = await supabase
        .from('achievements')
        .select('*')
        .in('target_role', ['buyer', 'all'])
        .order('sort_order');
      return (data ?? []) as Achievement[];
    },
  });

  const { data: unlocked = new Set<string>() } = useQuery({
    queryKey: ['user-achievements', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from('user_achievements')
        .select('achievement_id')
        .eq('user_id', userId!);
      return new Set((data ?? []).map((r: any) => r.achievement_id));
    },
  });

  if (!userId) return <div className="container mx-auto p-8 text-center text-ink-500">Caricamento…</div>;

  const unlockedCount = unlocked.size;
  const totalCount = achievements.length;
  const progress = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-4xl space-y-6">
      <div>
        <Link href="/profile" className="text-sm text-ink-500 hover:text-ink-800">← Profilo</Link>
        <h1 className="text-3xl font-serif font-bold mt-2 text-ink-900 flex items-center gap-2">
          <Trophy size={28} className="text-accent-600" />
          I miei badge
        </h1>
        <p className="text-sm text-ink-500 mt-1">Sblocca achievement per guadagnare punti loyalty extra</p>
      </div>

      {/* Progress overall */}
      <div className="bg-gradient-to-br from-primary-700 to-secondary-700 text-white rounded-2xl p-6 shadow-warm-lg">
        <div className="flex items-baseline gap-3 mb-3">
          <span className="text-5xl font-serif font-extrabold">{unlockedCount}</span>
          <span className="text-lg opacity-90">/ {totalCount} sbloccati</span>
        </div>
        <div className="h-3 bg-white/20 rounded-full overflow-hidden">
          <div className="h-full bg-accent-400 rounded-full transition-all duration-700" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-sm opacity-90 mt-2">{progress}% completato</p>
      </div>

      {/* Grid achievements */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {achievements.map((a) => {
          const isUnlocked = unlocked.has(a.id);
          return (
            <div
              key={a.id}
              className={`relative rounded-2xl border-2 p-5 transition-all ${
                isUnlocked
                  ? `bg-gradient-to-br ${TIER_BG[a.tier]} shadow-warm`
                  : 'bg-cream-50 border-cream-200 opacity-60'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`text-4xl ${isUnlocked ? 'animate-heart-beat' : 'grayscale'}`}>
                  {isUnlocked ? a.icon : '🔒'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-serif font-bold ${isUnlocked ? TIER_TEXT[a.tier] : 'text-ink-500'}`}>
                    {a.title}
                  </p>
                  <p className="text-xs text-ink-600 mt-0.5">{a.description}</p>
                  {a.points_reward > 0 && (
                    <p className="inline-flex items-center gap-1 text-xs font-bold mt-2 bg-white/70 rounded-full px-2 py-0.5">
                      <Sparkles size={11} className="text-primary-600" />
                      +{a.points_reward} pt
                    </p>
                  )}
                </div>
                {!isUnlocked && <Lock size={16} className="text-ink-400 shrink-0" />}
              </div>
              <p className={`text-[10px] uppercase font-bold tracking-wider mt-3 ${TIER_TEXT[a.tier]}`}>
                {a.tier}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

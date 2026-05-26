import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { Trophy, Sparkles, MapPin } from 'lucide-react';

export const revalidate = 300;

type Profile = {
  id: string;
  public_handle: string | null;
  public_bio: string | null;
  public_avatar_url: string | null;
  full_name: string | null;
};

async function fetchProfileByHandle(handle: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await supabase
      .from('profiles')
      .select('id, public_handle, public_bio, public_avatar_url, full_name')
      .ilike('public_handle', handle)
      .eq('public_profile_enabled', true)
      .maybeSingle();
    return data as Profile | null;
  } catch {
    return null;
  }
}

async function fetchAchievements(userId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await supabase
      .from('user_achievements')
      .select('achievement_id, unlocked_at, achievement:achievements!user_achievements_achievement_id_fkey ( title, icon, tier )')
      .eq('user_id', userId)
      .order('unlocked_at', { ascending: false })
      .limit(12);
    return (data ?? []) as any[];
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: { handle: string } }) {
  const profile = await fetchProfileByHandle(params.handle);
  if (!profile) return { title: 'Profilo non trovato · MyCity', robots: { index: false } };
  const name = profile.full_name?.split(' ')[0] ?? profile.public_handle;
  return {
    title: `@${profile.public_handle} · ${name} · MyCity`,
    description: profile.public_bio?.slice(0, 160) ?? `Il profilo pubblico di ${name} su MyCity Piacenza.`,
    openGraph: {
      title: `${name} su MyCity`,
      description: profile.public_bio ?? undefined,
      images: profile.public_avatar_url ? [profile.public_avatar_url] : undefined,
    },
  };
}

export default async function PublicProfilePage({ params }: { params: { handle: string } }) {
  const profile = await fetchProfileByHandle(params.handle);
  if (!profile) notFound();
  const achievements = await fetchAchievements(profile.id);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-2xl space-y-6">
      {/* Hero profilo */}
      <div className="bg-gradient-to-br from-primary-700 to-secondary-700 text-white rounded-3xl p-8 shadow-warm-lg text-center">
        <div className="w-24 h-24 mx-auto rounded-full bg-white/20 ring-4 ring-white/30 overflow-hidden flex items-center justify-center text-3xl font-serif font-bold mb-3">
          {profile.public_avatar_url ? (
            <Image src={profile.public_avatar_url} alt={profile.public_handle ?? ''} width={96} height={96} unoptimized className="object-cover" />
          ) : (
            (profile.full_name ?? profile.public_handle ?? '?')[0]?.toUpperCase()
          )}
        </div>
        <h1 className="text-2xl font-serif font-bold">@{profile.public_handle}</h1>
        {profile.full_name && <p className="text-sm opacity-90 mt-1">{profile.full_name}</p>}
        {profile.public_bio && (
          <p className="text-sm opacity-95 mt-3 italic max-w-md mx-auto">&laquo;{profile.public_bio}&raquo;</p>
        )}
        <div className="inline-flex items-center gap-1.5 text-xs bg-white/15 rounded-full px-3 py-1 mt-4">
          <MapPin size={12} />
          Buyer su MyCity Piacenza
        </div>
      </div>

      {/* Achievement showcase */}
      <section>
        <h2 className="font-serif font-bold text-lg text-ink-900 mb-3 flex items-center gap-2">
          <Trophy size={20} className="text-accent-600" />
          Achievement sbloccati ({achievements.length})
        </h2>
        {achievements.length === 0 ? (
          <div className="bg-white border border-cream-300 rounded-2xl p-8 text-center">
            <Sparkles size={28} className="mx-auto text-ink-300 mb-2" />
            <p className="text-sm text-ink-500">Nessun achievement ancora</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {achievements.map((a, i) => (
              <div key={i} className="bg-white border border-cream-300 rounded-xl p-3 text-center">
                <div className="text-3xl mb-1">{a.achievement?.icon ?? '🏆'}</div>
                <p className="text-xs font-semibold text-ink-700 leading-tight">{a.achievement?.title}</p>
                <p className="text-[10px] text-ink-400 uppercase mt-1">{a.achievement?.tier}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Footer CTA */}
      <div className="bg-cream-100 border border-cream-300 rounded-2xl p-5 text-center text-sm text-ink-600">
        <p>Vuoi un profilo pubblico come questo?</p>
        <Link href="/profile/settings" className="inline-block mt-2 text-primary-700 hover:underline font-semibold">
          Attiva profilo pubblico →
        </Link>
      </div>
    </div>
  );
}

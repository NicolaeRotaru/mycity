'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';

type Story = {
  id: string;
  feature_date: string;
  title: string;
  body: string;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  seller: { id: string; store_name: string | null; store_logo: string | null } | null;
};

/**
 * "Storia di oggi": un negoziante locale al giorno, con racconto editoriale.
 * Crea legame umano (anti-Amazon) e content marketing seppellito nel feed.
 * Foto + storia + CTA al negozio. Curata da admin.
 */
export default function StoryOfDay() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: story, isLoading } = useQuery({
    queryKey: queryKeys.home.dailyStory(today),
    queryFn: async (): Promise<Story | null> => {
      const { data } = await supabase
        .from('daily_stories')
        .select(`
          id, feature_date, title, body, image_url, cta_label, cta_url,
          seller:profiles!daily_stories_seller_id_fkey ( id, store_name, store_logo )
        `)
        .eq('feature_date', today)
        .maybeSingle();
      return (data as unknown as Story) ?? null;
    },
  });

  if (isLoading) {
    return <div className="h-80 rounded-2xl skeleton" aria-hidden />;
  }
  if (!story) return null;

  const ctaUrl = story.cta_url ?? (story.seller?.id ? `/store/${story.seller.id}` : null);

  return (
    <section className="rounded-2xl bg-cream-50 border border-cream-300 overflow-hidden shadow-warm">
      <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr]">
        <div className="relative aspect-[4/3] md:aspect-auto md:min-h-[320px] bg-cream-200">
          {story.image_url ? (
            <Image
              src={story.image_url}
              alt={story.title}
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              unoptimized
              className="object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-6xl">📖</div>
          )}
          {story.seller?.store_name && (
            <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur rounded-full px-3 py-1.5 flex items-center gap-2 shadow-warm">
              {story.seller.store_logo ? (
                <Image src={story.seller.store_logo} alt="" width={24} height={24} className="rounded-full object-cover" unoptimized />
              ) : (
                <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center text-xs font-bold text-primary-700">
                  {story.seller.store_name[0]}
                </div>
              )}
              <span className="text-xs font-semibold text-ink-900">{story.seller.store_name}</span>
            </div>
          )}
        </div>

        <div className="p-6 md:p-8 flex flex-col justify-center">
          <span className="inline-flex items-center gap-1.5 text-primary-700 text-xs font-bold uppercase tracking-wider mb-3">
            <BookOpen size={14} strokeWidth={2.4} />
            Storia di oggi
          </span>
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 leading-tight mb-3">
            {story.title}
          </h2>
          <p className="text-ink-700 leading-relaxed text-sm md:text-base whitespace-pre-line">
            {story.body.length > 280 ? story.body.slice(0, 280) + '…' : story.body}
          </p>
          {ctaUrl && (
            <Link
              href={ctaUrl}
              className="mt-5 inline-flex items-center gap-2 text-primary-700 hover:text-primary-800 font-semibold text-sm group w-fit"
            >
              {story.cta_label ?? 'Scopri il negozio'}
              <ArrowRight size={16} strokeWidth={2.4} className="group-hover:translate-x-1 transition-transform" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

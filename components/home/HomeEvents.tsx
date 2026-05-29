'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';

type Ev = {
  id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  discount_percent: number | null;
  cta_url: string | null;
};

/**
 * Striscia "Eventi a Piacenza" in home: mostra gli eventi attivi creati
 * dall'admin (marketplace_events, status scheduled/live). Si nasconde se non
 * ce ne sono (MaybeSection). Prima gli eventi comparivano solo in /events.
 */
export default function HomeEvents() {
  const { data: events = [] } = useQuery({
    queryKey: ['home', 'events'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Ev[]> => {
      const { data } = await supabase
        .from('marketplace_events')
        .select('id, title, description, cover_image_url, starts_at, ends_at, discount_percent, cta_url')
        .in('status', ['scheduled', 'live'])
        .order('starts_at', { ascending: true })
        .limit(4);
      return (data ?? []) as Ev[];
    },
  });

  if (events.length === 0) return null;

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 flex items-center gap-2">
          <CalendarDays size={24} strokeWidth={2.2} className="text-primary-600" />
          Eventi a Piacenza
        </h2>
        <Link href="/events" className="text-sm font-semibold text-primary-700 hover:underline inline-flex items-center gap-1 shrink-0">
          Vedi tutti <ArrowRight size={14} strokeWidth={2.4} />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {events.map((e) => (
          <Link
            key={e.id}
            href={e.cta_url || '/events'}
            className="group bg-white border border-cream-300 rounded-2xl overflow-hidden transition-shadow hover:shadow-warm"
          >
            <div className="relative aspect-[16/9] bg-gradient-to-br from-primary-100 to-secondary-100">
              {e.cover_image_url && (
                <Image src={sizedImage(e.cover_image_url, 'card')} alt="" fill sizes="(max-width: 640px) 100vw, 25vw" unoptimized className="object-cover" />
              )}
              {e.discount_percent ? (
                <span className="absolute top-2 right-2 bg-accent-500 text-ink-900 text-xs font-bold px-2 py-0.5 rounded-full">
                  -{e.discount_percent}%
                </span>
              ) : null}
            </div>
            <div className="p-4">
              <p className="font-bold text-ink-900 truncate group-hover:text-primary-700 transition-colors">{e.title}</p>
              {fmt(e.starts_at) && (
                <p className="text-xs text-ink-500 mt-0.5">
                  {fmt(e.starts_at)}{e.ends_at ? ` – ${fmt(e.ends_at)}` : ''}
                </p>
              )}
              {e.description && <p className="text-sm text-ink-600 mt-1 line-clamp-2">{e.description}</p>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, Users, Clock, Sparkles, CalendarDays, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

/**
 * Pagina Eventi MyCity — mercatino virtuale settimanale, flash sale, lancio prodotto.
 *
 * Esperti senior consultati:
 * - Growth PM: "Eventi ricorrenti = ritorno settimanale prevedibile = retention strutturata.
 *   Mercatino del sabato = appuntamento mentale come 'gusto dello shopping nel weekend'."
 * - Behavioral Scientist: "RSVP attiva commitment psicologico ('ho detto che vengo')
 *   → +60% probabilità di partecipazione. Mostra count partecipanti = social proof."
 * - Content Designer: "Voce calda, italiano vivo: 'Partecipa' non 'Register'."
 * - SEO Specialist: "Eventi con date sono opportunità ricche per schema Event JSON-LD →
 *   Google Discover."
 * - Marketplace PM: "Sponsor seller pagano per essere in evidenza → revenue stream
 *   secondaria oltre commissioni."
 * - Accessibility: "Date relative ('Inizia tra 3 giorni') aiutano comprensione."
 */

type EventRow = {
  id: string;
  title: string;
  description: string;
  cover_image_url: string | null;
  starts_at: string;
  ends_at: string;
  discount_percent: number | null;
  cta_label: string;
  cta_url: string | null;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  sponsor_seller_id: string | null;
  sponsor: { store_name: string | null; store_logo: string | null } | null;
};

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = t - now;
  const diffMin = Math.round(diffMs / 60000);
  const diffH = Math.round(diffMs / 3600_000);
  const diffD = Math.round(diffMs / 86_400_000);
  const past = diffMs < 0;
  if (Math.abs(diffMin) < 60) return past ? `${Math.abs(diffMin)} min fa` : `tra ${diffMin} min`;
  if (Math.abs(diffH) < 24) return past ? `${Math.abs(diffH)}h fa` : `tra ${diffH}h`;
  return past ? `${Math.abs(diffD)} giorni fa` : `tra ${diffD} giorni`;
}

export default function EventsPage() {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [myRsvps, setMyRsvps] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data } = await supabase.from('event_rsvps').select('event_id').eq('user_id', user.id);
      setMyRsvps(new Set((data ?? []).map((r: { event_id: string }) => r.event_id)));
    })();
  }, []);

  const { data: events = [], isLoading } = useQuery({
    queryKey: queryKeys.events.public,
    queryFn: async (): Promise<EventRow[]> => {
      const { data } = await supabase
        .from('marketplace_events')
        .select(`
          id, title, description, cover_image_url, starts_at, ends_at,
          discount_percent, cta_label, cta_url, status, sponsor_seller_id,
          sponsor:profiles!marketplace_events_sponsor_seller_id_fkey ( store_name, store_logo )
        `)
        .in('status', ['scheduled', 'live'])
        .order('starts_at', { ascending: true });
      return (data ?? []) as unknown as EventRow[];
    },
    refetchInterval: 60_000,
  });

  const rsvp = useMutation({
    mutationFn: async (eventId: string) => {
      if (!userId) throw new Error('Devi accedere per partecipare');
      const isGoing = myRsvps.has(eventId);
      if (isGoing) {
        const { error } = await supabase.from('event_rsvps').delete().eq('user_id', userId).eq('event_id', eventId);
        if (error) throw error;
        const next = new Set(myRsvps); next.delete(eventId); setMyRsvps(next);
        return false;
      } else {
        const { error } = await supabase.from('event_rsvps').insert({ user_id: userId, event_id: eventId });
        if (error) throw error;
        const next = new Set(myRsvps); next.add(eventId); setMyRsvps(next);
        return true;
      }
    },
    onSuccess: (going) => {
      toast.success(going ? 'Ci sei! Ti ricorderemo l\'evento.' : 'Cancellazione confermata');
      qc.invalidateQueries({ queryKey: queryKeys.events.public });
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const { data: rsvpCounts = {} } = useQuery({
    queryKey: queryKeys.events.rsvpCounts,
    queryFn: async (): Promise<Record<string, number>> => {
      const { data } = await supabase.from('event_rsvps').select('event_id');
      const counts: Record<string, number> = {};
      for (const r of (data ?? [])) counts[r.event_id] = (counts[r.event_id] ?? 0) + 1;
      return counts;
    },
    refetchInterval: 60_000,
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl space-y-8">
      <header className="text-center space-y-2">
        <span className="inline-flex items-center gap-1.5 bg-secondary-100 text-secondary-800 px-3 py-1 rounded-full text-xs font-bold tracking-wide ring-1 ring-secondary-200">
          <Sparkles size={14} strokeWidth={2.4} />
          Eventi MyCity
        </span>
        <h1 className="font-serif text-3xl md:text-4xl font-bold text-ink-900">
          Cosa succede in città
        </h1>
        <p className="text-ink-600 max-w-2xl mx-auto">
          Mercatini virtuali, flash sale, lanci. Partecipa e ricevi una notifica quando inizia.
        </p>
      </header>

      {isLoading ? (
        <LoadingState />
      ) : events.length === 0 ? (
        <div className="text-center text-ink-500 py-12">
          <CalendarDays size={48} className="mx-auto mb-3 text-ink-300" strokeWidth={1.5} />
          <p>Nessun evento programmato in questo momento.</p>
          <p className="text-xs mt-2">Torna presto: i nostri eventi escono ogni settimana.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {events.map((ev) => {
            const isGoing = myRsvps.has(ev.id);
            const isLive = ev.status === 'live';
            const count = rsvpCounts[ev.id] ?? 0;
            return (
              <li key={ev.id} className="bg-white border border-cream-300 rounded-2xl overflow-hidden shadow-warm flex flex-col">
                {ev.cover_image_url ? (
                  <div className="relative aspect-[16/9]">
                    <Image
                      src={sizedImage(ev.cover_image_url, 'detail')}
                      alt={ev.title}
                      fill
                      sizes="(max-width: 768px) 100vw, 400px"
                      className="object-cover"
                    />
                    {isLive && (
                      <span className="absolute top-3 left-3 inline-flex items-center gap-1 bg-rose-600 text-white px-2 py-1 rounded-full text-[10px] font-bold tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        LIVE ORA
                      </span>
                    )}
                    {ev.discount_percent ? (
                      <span className="absolute top-3 right-3 bg-accent-500 text-ink-900 px-2 py-1 rounded-full text-xs font-bold">
                        -{ev.discount_percent}%
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className="p-5 flex flex-col flex-1 gap-3">
                  <div>
                    <h3 className="font-serif text-xl font-bold text-ink-900">{ev.title}</h3>
                    <p className="text-sm text-ink-600 line-clamp-3 mt-1">{ev.description}</p>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-ink-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} strokeWidth={2.2} />
                      {isLive ? `Termina ${relativeTime(ev.ends_at)}` : `Inizia ${relativeTime(ev.starts_at)}`}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users size={12} strokeWidth={2.2} />
                      {count} partecipanti
                    </span>
                  </div>

                  {ev.sponsor?.store_name && (
                    <div className="text-xs text-ink-500 inline-flex items-center gap-1">
                      <span>Sponsor:</span>
                      <span className="font-semibold text-ink-700">{ev.sponsor.store_name}</span>
                    </div>
                  )}

                  <div className="flex gap-2 mt-auto pt-3">
                    <button
                      onClick={() => userId ? rsvp.mutate(ev.id) : toast.error('Accedi per partecipare')}
                      disabled={rsvp.isPending}
                      className={`flex-1 px-4 py-2 rounded-full font-bold text-sm transition-colors ${
                        isGoing
                          ? 'bg-olive-100 text-olive-800 ring-1 ring-olive-300'
                          : 'bg-primary-700 hover:bg-primary-800 text-white'
                      }`}
                    >
                      {isGoing ? <span className="inline-flex items-center gap-1"><Check size={16} strokeWidth={2.4} aria-hidden /> Ci sei</span> : ev.cta_label}
                    </button>
                    {ev.cta_url && isLive && (
                      <Link
                        href={ev.cta_url}
                        className="px-4 py-2 rounded-full font-bold text-sm bg-accent-400 hover:bg-accent-500 text-ink-900"
                      >
                        Vai all'evento
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Truck, Package, ShoppingCart } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';

type Activity = {
  created_at: string;
  delivery_status: string;
  delivery_city: string | null;
  store_name: string | null;
};

// Chi ha ordinato non si dice. Prima questa riga leggeva delivery_full_name
// dalla tabella orders e lo accorciava qui nel browser ("Mario R."): il nome
// intero, col resto dell'ordine, arrivava comunque a ogni visitatore. Ora la
// vista live_activity_public non lo contiene affatto, e al suo posto c'e' la
// citta', che e' prova sociale senza essere un dato personale.
function chiHaOrdinato(citta: string | null | undefined): string {
  return citta ? `Qualcuno a ${citta}` : 'Qualcuno';
}

function timeAgo(date: string, now: number): string {
  const diff = now - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ora';
  if (mins < 60) return `${mins} min fa`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h fa`;
  const d = Math.floor(h / 24);
  return `${d}g fa`;
}

const LiveActivityFeed = () => {
  const [pulse, setPulse] = useState(false);
  // null durante SSR per evitare hydration mismatch: Date.now() differisce
  // tra server e client. timeAgo renderizzato solo dopo hydration.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    // Refresh "X min fa" ogni minuto
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { data: activities = [] } = useQuery({
    queryKey: queryKeys.home.liveFeed,
    queryFn: async () => {
      const { data } = await supabase
        .from('live_activity_public')
        // 040 — `id` non si chiede più: era l'identità dell'ordine, cioè quello
        // che permetteva a un concorrente di riconoscere gli ordini uno per uno
        // e contarli per negozio. La vista smetterà di darlo (migrazione 120), e
        // questa riga deve smettere di chiederlo PRIMA che quella parta.
        //
        // 27/8/2026 (R030) — e adesso nemmeno `seller_id`: la vista lo smette di dare con la
        // migrazione 142, che aggiunge anche il DISTINCT (tre ordini nella stessa ora dallo stesso
        // negozio erano tre righe, cioè il volume della bottega leggibile da chiunque). Si perde
        // il collegamento alla vetrina da questa riga: si paga volentieri.
        .select('created_at, delivery_status, delivery_city, store_name')
        .order('created_at', { ascending: false })
        .limit(8);
      return (data ?? []) as unknown as Activity[];
    },
    // 093 — Prima non c'era ricarica periodica perche' c'era un collegamento
    // permanente in ascolto sulla tabella ordini: UNO PER VISITATORE della home,
    // aperto anche da chi guarda e se ne va. Con mille visitatori sono mille
    // canali che il database deve tenere in piedi per aggiornare un riquadro di
    // prova sociale. Questo riquadro deve mostrare che il marketplace e' vivo,
    // non l'istante esatto in cui arriva un ordine: una richiesta al minuto da'
    // la stessa sensazione e non costa niente.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
  });

  // Il battito visivo segue la ricarica, non piu' un evento del database.
  useEffect(() => {
    if (activities.length === 0) return;
    setPulse(true);
    const id = setTimeout(() => setPulse(false), 1500);
    return () => clearTimeout(id);
  }, [activities]);

  if (activities.length === 0) return null;

  return (
    <section className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-serif font-bold text-ink-900 text-lg flex items-center gap-2.5">
          <span className="relative inline-flex">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-olive-500" />
            <span className={`absolute inset-0 inline-block w-2.5 h-2.5 rounded-full bg-olive-500 ${pulse ? 'animate-ping' : 'animate-pulse-soft'}`} />
          </span>
          Cosa sta succedendo a Piacenza
        </h2>
        <span className="text-xs text-ink-400 uppercase tracking-wider font-semibold">Live</span>
      </div>
      <ul className="space-y-1">
        {activities.map((a, i) => {
          const verb = a.delivery_status === 'DELIVERED'
            ? 'ha ricevuto un ordine da'
            : 'ha appena ordinato da';
          return (
            <li key={`${a.store_name ?? 'x'}-${a.created_at}-${i}`} className="flex items-center gap-3 text-sm py-2 border-b border-cream-200 last:border-0 hover:bg-cream-50 -mx-2 px-2 rounded transition-colors">
              <span className="shrink-0 text-ink-500">
                {a.delivery_status === 'DELIVERED' ? <CheckCircle2 size={18} strokeWidth={2.2} className="text-olive-600" aria-hidden /> :
                 a.delivery_status === 'OUT_FOR_DELIVERY' ? <Truck size={18} strokeWidth={2.2} className="text-primary-600" aria-hidden /> :
                 a.delivery_status === 'READY' ? <Package size={18} strokeWidth={2.2} aria-hidden /> : <ShoppingCart size={18} strokeWidth={2.2} aria-hidden />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="truncate">
                  <strong className="text-ink-900">{chiHaOrdinato(a.delivery_city)}</strong>
                  <span className="text-ink-500"> {verb} </span>
                  <span className="font-semibold text-ink-700">{a.store_name ?? 'un negozio'}</span>
                </p>
              </div>
              <span className="text-xs text-ink-400 shrink-0">{now !== null ? timeAgo(a.created_at, now) : ''}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default LiveActivityFeed;

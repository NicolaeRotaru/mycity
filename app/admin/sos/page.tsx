'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

/**
 * Admin: gestione eventi SOS rider.
 *
 * Esperti consultati:
 * - Trust & Safety: "Dashboard 'attivi' separati da 'risolti'. Active SOS
 *   pinned in top con tempo di attesa visualizzato."
 * - Operations: "Click su 'risolto' richiede note (es. 'chiamato rider, falso
 *   allarme' o 'rider ricoverato'). Audit trail."
 */

type SOS = {
  id: string;
  rider_id: string;
  order_id: string | null;
  lat: number | null;
  lng: number | null;
  triggered_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  rider: { full_name: string | null; phone: string | null } | null;
};

export default function AdminSOSPage() {
  const qc = useQueryClient();

  const { data: sosList = [] } = useQuery({
    queryKey: queryKeys.admin.sos,
    queryFn: async (): Promise<SOS[]> => {
      const { data } = await supabase
        .from('rider_sos_events')
        .select(`
          id, rider_id, order_id, lat, lng, triggered_at, resolved_at, resolution_note,
          rider:profiles!rider_sos_events_rider_id_fkey ( full_name, phone )
        `)
        .order('triggered_at', { ascending: false })
        .limit(50);
      return (data ?? []) as unknown as SOS[];
    },
    refetchInterval: 10_000,
  });

  const resolve = useMutation({
    mutationFn: async (vars: { id: string; note: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('rider_sos_events')
        .update({
          resolved_at: new Date().toISOString(),
          resolution_note: vars.note,
          handled_by: user?.id ?? null,
        })
        .eq('id', vars.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('SOS risolto');
      qc.invalidateQueries({ queryKey: queryKeys.admin.sos });
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const active = sosList.filter((s) => !s.resolved_at);
  const resolved = sosList.filter((s) => s.resolved_at);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink-900 flex items-center gap-2">
          <AlertTriangle size={22} className="text-rose-600" strokeWidth={2.4} />
          SOS Rider
        </h1>
        <p className="text-sm text-ink-500 mt-1">
          Eventi di emergenza attivati dai rider. Auto-refresh ogni 10s.
        </p>
      </header>

      {/* SOS attivi */}
      <section>
        <h2 className="font-bold text-rose-700 mb-3">
          🔴 Attivi ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-ink-500 bg-olive-50 border border-olive-200 rounded-lg p-4">
            ✓ Nessun SOS attivo. Tutto tranquillo.
          </p>
        ) : (
          <ul className="space-y-3">
            {active.map((s) => {
              const elapsed = Math.round((Date.now() - new Date(s.triggered_at).getTime()) / 60_000);
              return (
                <li key={s.id} className="bg-rose-50 border-2 border-rose-300 rounded-xl p-4">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                      <p className="font-bold text-rose-900 text-lg">
                        {s.rider?.full_name ?? 'Rider sconosciuto'}
                      </p>
                      <p className="text-sm text-ink-700">
                        Attivato: {new Date(s.triggered_at).toLocaleString('it-IT')}
                      </p>
                      <p className="text-sm font-semibold text-rose-700">
                        ⏱ {elapsed} min fa
                      </p>
                      {s.rider?.phone && (
                        <a href={`tel:${s.rider.phone}`} className="inline-block mt-1 text-sm text-primary-700 hover:underline">
                          📞 {s.rider.phone}
                        </a>
                      )}
                    </div>
                    {s.lat && s.lng && (
                      <a
                        href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 bg-white border border-rose-300 text-rose-700 px-3 py-2 rounded-lg font-semibold text-sm"
                      >
                        <MapPin size={14} strokeWidth={2.4} /> Mappa posizione
                      </a>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      const note = prompt('Note risoluzione (obbligatorie):');
                      if (note && note.trim()) {
                        resolve.mutate({ id: s.id, note: note.trim() });
                      }
                    }}
                    className="mt-3 inline-flex items-center gap-1.5 bg-olive-600 hover:bg-olive-700 text-white px-4 py-2 rounded-lg font-bold text-sm"
                  >
                    <Check size={14} strokeWidth={2.4} /> Marca risolto
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* SOS risolti */}
      <section>
        <h2 className="font-bold text-ink-700 mb-3">Storico ({resolved.length})</h2>
        {resolved.length === 0 ? (
          <p className="text-sm text-ink-500">Nessun SOS risolto.</p>
        ) : (
          <ul className="space-y-2">
            {resolved.map((s) => (
              <li key={s.id} className="bg-white border border-cream-200 rounded-lg p-3 text-sm">
                <p className="font-semibold text-ink-900">{s.rider?.full_name ?? 'Rider'}</p>
                <p className="text-xs text-ink-500">
                  {new Date(s.triggered_at).toLocaleString('it-IT')} → risolto {s.resolved_at && new Date(s.resolved_at).toLocaleString('it-IT')}
                </p>
                {s.resolution_note && <p className="text-xs text-ink-600 italic mt-1">&quot;{s.resolution_note}&quot;</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

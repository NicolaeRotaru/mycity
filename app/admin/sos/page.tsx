'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, MapPin, Phone, Clock, Siren, History } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { AdminPageTitle, AdminSectionLabel } from '@/components/admin/AdminUI';

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
      <AdminPageTitle
        eyebrow="Sicurezza"
        title="SOS rider"
        sub="Emergenze segnalate dai rider durante le consegne. Aggiornamento automatico ogni 10s."
      />

      {/* SOS attivi */}
      <section>
        <AdminSectionLabel icon={Siren}>Attivi ({active.length})</AdminSectionLabel>
        {active.length === 0 ? (
          <p className="text-sm text-ink-500 bg-olive-50 border border-olive-200 rounded-lg p-4 flex items-center gap-1.5">
            <Check size={16} strokeWidth={2.4} className="text-olive-600 shrink-0" aria-hidden />
            Nessun SOS attivo. Tutto tranquillo.
          </p>
        ) : (
          <ul className="space-y-3">
            {active.map((s) => {
              const elapsed = Math.round((Date.now() - new Date(s.triggered_at).getTime()) / 60_000);
              return (
                <li key={s.id} className="bg-secondary-50 border-2 border-secondary-300 rounded-xl p-4">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="flex items-start gap-3">
                      <span
                        className="w-12 h-12 rounded-full bg-secondary-600 text-white inline-flex items-center justify-center shrink-0 animate-pulse-soft"
                        aria-hidden
                      >
                        <Siren size={24} strokeWidth={2.4} />
                      </span>
                      <div>
                        <p className="font-bold text-secondary-900 text-lg">
                          {s.rider?.full_name ?? 'Rider sconosciuto'}
                        </p>
                        <p className="text-sm text-ink-700">
                          Attivato: {new Date(s.triggered_at).toLocaleString('it-IT')}
                        </p>
                        <p className="text-sm font-semibold text-secondary-700 flex items-center gap-1.5">
                          <Clock size={14} strokeWidth={2.4} aria-hidden />
                          {elapsed} min fa
                        </p>
                        {s.rider?.phone && (
                          <a href={`tel:${s.rider.phone}`} className="inline-flex items-center gap-1.5 mt-1 text-sm text-primary-700 hover:underline">
                            <Phone size={14} strokeWidth={2.4} aria-hidden />
                            {s.rider.phone}
                          </a>
                        )}
                      </div>
                    </div>
                    {s.lat && s.lng && (
                      <a
                        href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 bg-white border border-secondary-300 text-secondary-700 px-3 py-2 rounded-lg font-semibold text-sm"
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
        <AdminSectionLabel icon={History}>Storico ({resolved.length})</AdminSectionLabel>
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

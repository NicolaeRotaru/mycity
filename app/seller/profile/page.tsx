'use client';

import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Zap, Palette } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

/**
 * Profilo negozio = impostazioni PRIVATE/operative del venditore.
 * Tutto ciò che si vede in vetrina (logo, nome, copertina, descrizione, contatti,
 * orari, personalizzazione) si gestisce in "Costruisci il sito" (/seller/site →
 * schermata "Dettagli negozio").
 */
export default function SellerProfilePage() {
  const qc = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: queryKeys.seller.profile,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (error) throw error;
      return data;
    },
  });

  const updateExpress = useMutation({
    mutationFn: async (value: boolean) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase.from('profiles').update({ offers_express: value }).eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.profile });
      toast.success('Preferenza Express aggiornata');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (isLoading) return <LoadingState />;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-serif text-ink-900">Profilo negozio</h1>
          <p className="text-sm text-ink-500">Impostazioni private e operative del tuo negozio</p>
        </div>
        {profile?.is_approved && profile?.id && (
          <Link
            href={`/store/${profile.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-white border border-cream-300 hover:border-primary-300 text-ink-800 px-4 py-2 rounded-lg text-sm font-semibold shadow-warm-sm transition-colors"
          >
            <ExternalLink size={16} aria-hidden />
            Vedi la tua vetrina
          </Link>
        )}
      </div>

      <div className="bg-olive-50 border border-olive-200 rounded-lg p-4 text-olive-800 text-sm">
        ✅ Negozio attivo · I tuoi prodotti sono visibili nel marketplace
      </div>

      {/* Aspetto e dati della vetrina → si gestiscono nel site builder */}
      <div className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6">
        <div className="flex items-start gap-3">
          <Palette size={20} className="text-primary-600 shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-ink-900">Aspetto e dati della vetrina</p>
            <p className="text-sm text-ink-500 mt-0.5">
              Logo, nome, copertina, descrizione, contatti, orari e personalizzazione ora si
              gestiscono in <span className="font-medium text-ink-700">Costruisci il sito</span> → Dettagli negozio.
            </p>
            <Link
              href="/seller/site?details=1"
              className="inline-flex items-center gap-2 mt-3 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              <Palette size={16} aria-hidden /> Vai ai dettagli del negozio
            </Link>
          </div>
        </div>
      </div>

      {/* Consegna Express a livello negozio (default per i prodotti) — impostazione operativa */}
      <div className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6">
        <label className="flex items-start justify-between gap-4 cursor-pointer">
          <div>
            <p className="font-bold text-ink-900 flex items-center gap-2">
              <Zap size={18} strokeWidth={2.4} className="text-amber-500" aria-hidden /> Offro consegna Express
            </p>
            <p className="text-sm text-ink-500 mt-0.5">
              Diventa il default per i tuoi prodotti (~30–60 min se disponibile). Puoi escludere singoli prodotti dalla loro scheda.
            </p>
          </div>
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0 accent-amber-500"
            checked={Boolean((profile as { offers_express?: boolean } | undefined)?.offers_express)}
            disabled={updateExpress.isPending}
            onChange={(e) => updateExpress.mutate(e.target.checked)}
          />
        </label>
      </div>
    </div>
  );
}

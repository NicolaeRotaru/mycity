'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trophy, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { Button } from '@/components/ui/Button';
import { ImageUrlField } from '@/components/ImageUrlField';
import { AdminPageTitle, AdminSectionLabel } from '@/components/admin/AdminUI';
import { primoDelMesePiacenza } from '@/lib/tempo-piacenza';

/**
 * Admin: Negozio del mese.
 *
 * Esperti consultati:
 * - Marketplace PM: "Admin sceglie 1 pick/mese. Combinato con voto utenti, motiva
 *   seller a curare lo storefront."
 * - Content Designer: "Headline curato a mano + story breve = anima rivista,
 *   diversa da algoritmo."
 * - Operations Manager: "Form semplice, no upload immagine inline (usano URL
 *   bucket esistenti). Cosa cambia: 5 campi max → 30 secondi/mese."
 * - Trust & Safety: "Solo seller is_approved selezionabili."
 * - Senior PM: "Mostra anche leaderboard voti per ispirazione admin."
 */

type Seller = { id: string; store_name: string | null; store_logo: string | null };
type LB = { seller_id: string; store_name: string | null; store_logo: string | null; vote_count: number };

export default function AdminShopOfMonthPage() {
  const qc = useQueryClient();
  // #211 — Stessa chiave-mese di chi vota: quella di Piacenza.
  const firstOfMonth = primoDelMesePiacenza();

  const [sellerId, setSellerId] = useState('');
  const [headline, setHeadline] = useState('');
  const [story, setStory] = useState('');
  const [coverUrl, setCoverUrl] = useState('');

  // 5/11/2026 (S05) — Le tre letture lanciano l'errore. Prima, se cadeva quella del
  // mese, il modulo si apriva vuoto con «Imposta pick del mese» e salvando si
  // sovrascriveva il pick già scelto; se cadeva quella dei voti, «Nessun voto».
  const { data: existing, isError: meseNonLetto, refetch: rileggiMese } = useQuery({
    queryKey: queryKeys.admin.shopOfMonth(firstOfMonth),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shop_of_month')
        .select('*')
        .eq('month', firstOfMonth)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (existing) {
      setSellerId(existing.seller_id);
      setHeadline(existing.headline ?? '');
      setStory(existing.story ?? '');
      setCoverUrl(existing.cover_image_url ?? '');
    }
  }, [existing]);

  const { data: sellers = [], isError: negoziNonLetti } = useQuery({
    queryKey: queryKeys.admin.approvedSellers,
    queryFn: async (): Promise<Seller[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, store_name, store_logo')
        .eq('role', 'seller')
        .eq('is_approved', true)
        .order('store_name');
      if (error) throw error;
      return (data ?? []) as Seller[];
    },
  });

  const { data: classifica = [], isError: votiNonLetti } = useQuery({
    queryKey: queryKeys.admin.shopOfMonthLeaderboard,
    queryFn: async (): Promise<LB[]> => {
      const { data, error } = await supabase.from('shop_of_month_leaderboard').select('*');
      if (error) throw error;
      return (data ?? []) as LB[];
    },
  });
  // La vista mette in fila TUTTI i negozi approvati, anche a zero voti: qui restano
  // solo quelli votati, così «Nessun voto» compare quando è vero.
  const leaderboard = classifica.filter((r) => Number(r.vote_count) > 0);

  const save = useMutation({
    mutationFn: async () => {
      if (!sellerId) throw new Error('Seleziona un negozio');
      // Senza sapere se il mese ha già un pick, salvare potrebbe cancellarlo.
      if (meseNonLetto) throw new Error('Non riesco a leggere il pick di questo mese: riprova prima di salvare');
      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        month: firstOfMonth,
        seller_id: sellerId,
        headline: headline.trim() || null,
        story: story.trim() || null,
        cover_image_url: coverUrl.trim() || null,
        discount_code: null,
        discount_percent: null,
        selected_by: user?.id ?? null,
      };
      const { error } = await supabase
        .from('shop_of_month')
        .upsert(payload, { onConflict: 'month' });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Negozio del mese aggiornato');
      qc.invalidateQueries({ queryKey: queryKeys.admin.shopOfMonth(firstOfMonth) });
      qc.invalidateQueries({ queryKey: queryKeys.shopOfMonth.current });
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  return (
    <div className="space-y-8">
      <AdminPageTitle
        eyebrow="Marketing"
        title="Negozio del mese"
        sub={`Mese: ${new Date(firstOfMonth).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}. Imposta un solo pick al mese; il voto degli utenti corre in parallelo.`}
      />

      {meseNonLetto && (
        <div role="alert" className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-800">
          Non riesco a leggere il pick di questo mese: non so se ce n&apos;è già uno. Il salvataggio resta fermo finché non lo leggo.{' '}
          <button type="button" onClick={() => { void rileggiMese(); }} className="font-semibold underline">Riprova</button>
        </div>
      )}
      {negoziNonLetti && (
        <p role="alert" className="text-sm text-secondary-700">Non riesco a leggere l&apos;elenco dei negozi approvati.</p>
      )}

      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="bg-white border border-cream-300 rounded-xl p-6 space-y-4">
        <div>
          <label className="block text-sm font-semibold text-ink-700 mb-1">Negozio</label>
          <select
            value={sellerId}
            onChange={(e) => setSellerId(e.target.value)}
            className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">— Seleziona —</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>{s.store_name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold text-ink-700 mb-1">Headline (titolo redazione)</label>
          <input
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            maxLength={120}
            placeholder="Es: La salumeria che riscopre i sapori dimenticati"
            className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-ink-700 mb-1">Story (breve racconto)</label>
          <textarea
            value={story}
            onChange={(e) => setStory(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Una storia di passione e tradizione locale…"
            className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm resize-none"
          />
        </div>

        <ImageUrlField
          label="Immagine cover (16:9 consigliato)"
          value={coverUrl}
          onChange={setCoverUrl}
          pathPrefix="shop"
          hint="Carica un file o incolla un URL."
        />

        {/* Il codice sconto del mese era testo libero, non legato ai coupon: la home lo
            annunciava e la cassa non lo conosceva. Tolto; salvando, uno vecchio si cancella. */}
        <p className="text-xs text-ink-500">Niente codice sconto del mese: un codice scritto qui non arrivava in cassa. Salvando, un codice già salvato per il mese viene tolto.</p>

        <Button type="submit" loading={save.isPending} disabled={meseNonLetto}>
          {existing ? 'Aggiorna pick' : 'Imposta pick del mese'}
        </Button>
      </form>

      {/* Leaderboard voti */}
      <section>
        <AdminSectionLabel icon={Trophy}>Voto utenti (live)</AdminSectionLabel>
        {votiNonLetti ? (
          <p role="alert" className="text-sm text-secondary-700">Non riesco a leggere i voti di questo mese.</p>
        ) : leaderboard.length === 0 ? (
          <p className="text-sm text-ink-500">Nessun voto registrato per questo mese.</p>
        ) : (
          <ol className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {leaderboard.slice(0, 10).map((row, i) => (
              <li key={row.seller_id} className="bg-white border border-cream-200 rounded-lg p-3 flex items-center gap-3">
                <span className="w-7 h-7 rounded-full bg-cream-100 text-ink-700 flex items-center justify-center font-bold text-xs">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ink-900 text-sm truncate">{row.store_name ?? '—'}</p>
                  <p className="text-xs text-ink-500">{row.vote_count} {row.vote_count === 1 ? 'voto' : 'voti'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSellerId(row.seller_id)}
                  className="text-xs text-primary-700 hover:text-primary-800 font-semibold inline-flex items-center gap-1"
                >
                  Scegli <ArrowRight size={12} strokeWidth={2.4} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

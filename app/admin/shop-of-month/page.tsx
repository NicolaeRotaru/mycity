'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Crown, Trophy, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

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
  const firstOfMonth = (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); })();

  const [sellerId, setSellerId] = useState('');
  const [headline, setHeadline] = useState('');
  const [story, setStory] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [discountCode, setDiscountCode] = useState('');
  const [discountPct, setDiscountPct] = useState<number | ''>('');

  const { data: existing } = useQuery({
    queryKey: queryKeys.admin.shopOfMonth(firstOfMonth),
    queryFn: async () => {
      const { data } = await supabase
        .from('shop_of_month')
        .select('*')
        .eq('month', firstOfMonth)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (existing) {
      setSellerId(existing.seller_id);
      setHeadline(existing.headline ?? '');
      setStory(existing.story ?? '');
      setCoverUrl(existing.cover_image_url ?? '');
      setDiscountCode(existing.discount_code ?? '');
      setDiscountPct(existing.discount_percent ?? '');
    }
  }, [existing]);

  const { data: sellers = [] } = useQuery({
    queryKey: queryKeys.admin.approvedSellers,
    queryFn: async (): Promise<Seller[]> => {
      const { data } = await supabase
        .from('profiles')
        .select('id, store_name, store_logo')
        .eq('role', 'seller')
        .eq('is_approved', true)
        .order('store_name');
      return (data ?? []) as Seller[];
    },
  });

  const { data: leaderboard = [] } = useQuery({
    queryKey: queryKeys.admin.shopOfMonthLeaderboard,
    queryFn: async (): Promise<LB[]> => {
      const { data } = await supabase.from('shop_of_month_leaderboard').select('*');
      return (data ?? []) as LB[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!sellerId) throw new Error('Seleziona un negozio');
      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        month: firstOfMonth,
        seller_id: sellerId,
        headline: headline.trim() || null,
        story: story.trim() || null,
        cover_image_url: coverUrl.trim() || null,
        discount_code: discountCode.trim().toUpperCase() || null,
        discount_percent: typeof discountPct === 'number' ? discountPct : null,
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
      qc.invalidateQueries({ queryKey: ['shop-of-month-current'] });
    },
    onError: (err: any) => toast.error(friendlyError(err)),
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-ink-900 flex items-center gap-2">
          <Crown size={22} className="text-accent-500" strokeWidth={2.2} />
          Negozio del mese
        </h1>
        <p className="text-sm text-ink-500 mt-1">
          Mese: <strong>{new Date(firstOfMonth).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</strong>.
          Imposta un solo pick al mese; il voto degli utenti corre in parallelo.
        </p>
      </header>

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

        <div>
          <label className="block text-sm font-semibold text-ink-700 mb-1">URL immagine cover (16:9 consigliato)</label>
          <input
            type="url"
            value={coverUrl}
            onChange={(e) => setCoverUrl(e.target.value)}
            placeholder="https://…"
            className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1">Codice sconto (opzionale)</label>
            <input
              type="text"
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
              placeholder="BORGO15"
              className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1">Percentuale sconto</label>
            <input
              type="number"
              value={discountPct}
              onChange={(e) => setDiscountPct(e.target.value ? Number(e.target.value) : '')}
              min={0}
              max={50}
              className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={save.isPending}
          className="bg-primary-700 hover:bg-primary-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold"
        >
          {save.isPending ? 'Salvataggio…' : existing ? 'Aggiorna pick' : 'Imposta pick del mese'}
        </button>
      </form>

      {/* Leaderboard voti */}
      <section>
        <h2 className="font-bold text-ink-900 mb-3 flex items-center gap-2">
          <Trophy size={18} className="text-accent-500" strokeWidth={2.2} />
          Voto utenti (live)
        </h2>
        {leaderboard.length === 0 ? (
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

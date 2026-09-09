'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { formatPrice, formatDate } from '@/lib/format';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { useTranslations } from 'next-intl';
import { AdminPageTitle } from '@/components/admin/AdminUI';
import { ErrorState } from '@/components/ui/ErrorState';
import {
  vistaDelleCampagne,
  nomeDellaCampagna,
  etichettaStato,
  ETICHETTA_FILTRO,
  type Campagna,
  type ElencoCampagne,
  type FiltroCampagne,
} from '@/lib/admin/vista-delle-campagne';
import {
  cambiaStatoCampagna,
  eliminaCampagna,
  chiaveDelleCampagne,
} from '@/lib/admin/scritture-delle-campagne';

/**
 * Admin: gestione sponsored listings.
 *
 * Esperti consultati:
 * - Marketplace PM: "Admin deve vedere campagne attive, performance (CTR), e poter
 *   pausare campagne fraudolente o di seller a basso rating."
 * - Trust & Safety: "Disabilita campagne se seller sotto rating 3.5 o
 *   contestato. Pause = preserva budget non speso."
 * - Data Analyst: "CTR = clicks/impressions. CPC = spent/clicks. Mostralo
 *   in tabella per evaluation veloce."
 * - Finance Manager: "Budget speso vs budget allocato = report finanziario."
 *
 * ── 8/9/2026 — QUESTA PAGINA DAVA PER VERI NUMERI CHE NON AVEVA VERIFICATO ───────────────────
 * ① «Speso totale» era il totale del FILTRO acceso. Il filtro sta dentro la lettura, quindi
 *    quello che arrivava era già ristretto, ma i quattro riquadri tenevano l'etichetta ferma:
 *    premevi «In pausa» e i soldi scendevano, come se la spesa pubblicitaria fosse crollata.
 * ② La lettura buttava via l'errore (`const { data } = await q`), quindi un guasto diventava
 *    «Nessuna campagna» e quattro riquadri a zero.
 * ③ I due pulsanti festeggiavano senza prova: `update` senza guardare le righe toccate, e la
 *    cache svuotata su una chiave che NON è quella della lista filtrata.
 * Etichette e numeri escono ora dalla stessa funzione — `lib/admin/vista-delle-campagne.ts` — e
 * le scritture da `lib/admin/scritture-delle-campagne.ts`, che pretende le righe indietro.
 */

const FILTRI: readonly FiltroCampagne[] = ['all', 'active', 'paused', 'ended'];

export default function AdminSponsoredPage() {
  const qc = useQueryClient();
  const tStates = useTranslations('states');
  const [filter, setFilter] = useState<FiltroCampagne>('all');

  // Niente `= []`: un ripiego qui vuol dire spacciare «non ho letto» per «non c'è niente».
  // E il conteggio esatto viaggia insieme alle righe: senza, «totale» resta una parola che non
  // possiamo dimostrare, perché una risposta lunga PostgREST la tronca.
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.admin.sponsored(filter),
    queryFn: async (): Promise<ElencoCampagne> => {
      let q = supabase
        .from('sponsored_listings')
        .select(
          `
          id, product_id, seller_id, placement, category_slug,
          start_date, end_date, daily_budget_cents, spent_cents,
          impressions, clicks, status,
          product:products!sponsored_listings_product_id_fkey ( name ),
          seller:profiles!sponsored_listings_seller_id_fkey ( store_name )
        `,
          { count: 'exact' },
        )
        .order('created_at', { ascending: false });
      if (filter !== 'all') q = q.eq('status', filter);
      const { data, error, count } = await q;
      if (error) throw error;
      return {
        campagne: (data ?? []) as unknown as Campagna[],
        totale: typeof count === 'number' ? count : null,
      };
    },
  });

  const vista = vistaDelleCampagne({ data, isPending, isError, error }, filter);

  const setStatus = useMutation({
    mutationFn: (v: { campagna: Campagna; status: Campagna['status'] }) =>
      cambiaStatoCampagna(supabase, v.campagna, v.status),
    onSuccess: (_esito, v) =>
      toast.success(
        `«${nomeDellaCampagna(v.campagna)}» ora è ${etichettaStato(v.status)}`,
      ),
    onError: (err: unknown) => toast.error(friendlyError(err)),
    // L'elenco si ricarica comunque, e sul RAMO: dopo un tentativo andato male la verità sta nel
    // database, non in quello che ha in mano il browser.
    onSettled: () => qc.invalidateQueries({ queryKey: chiaveDelleCampagne() }),
  });

  const del = useMutation({
    mutationFn: (campagna: Campagna) => eliminaCampagna(supabase, campagna),
    onSuccess: (_esito, campagna) =>
      toast.success(`Campagna «${nomeDellaCampagna(campagna)}» eliminata`),
    onError: (err: unknown) => toast.error(friendlyError(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: chiaveDelleCampagne() }),
  });

  const inCorso = setStatus.isPending || del.isPending;

  const STATUS_BADGE: Record<Campagna['status'], string> = {
    active: 'bg-olive-100 text-olive-800',
    paused: 'bg-accent-100 text-accent-800',
    ended: 'bg-cream-100 text-ink-600',
  };

  return (
    <div className="space-y-6">
      <AdminPageTitle
        eyebrow="Marketing"
        title="Sponsorizzati"
        sub={vista.sottotitolo}
      />

      {/*
        I quattro riquadri. L'etichetta arriva dalla stessa funzione che fa il conto, quindi non
        può più dire «totale» su un pezzo — e finché non abbiamo letto mostra «—», non «0».
      */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {vista.riquadri.map((r) => (
          <div key={r.chiave} className="bg-white border border-cream-300 rounded-xl p-4">
            <p className="text-xs uppercase tracking-wider text-ink-500 font-semibold">{r.etichetta}</p>
            <p className="text-2xl font-bold text-ink-900">{r.valore}</p>
          </div>
        ))}
      </div>

      {/* La riga che dice cosa stanno contando quei numeri, quando non contano tutto. */}
      {vista.perimetro && (
        <p className="text-sm text-ink-600 bg-accent-50 border border-accent-200 rounded-lg px-3 py-2">
          {vista.perimetro}
        </p>
      )}

      {/* Filtri */}
      <div className="flex gap-2 flex-wrap">
        {FILTRI.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            aria-pressed={filter === s}
            className={`px-3 py-1.5 rounded-full text-xs font-bold min-h-[36px] ${
              filter === s
                ? 'bg-primary-700 text-white'
                : 'bg-white border border-cream-300 text-ink-700 hover:bg-cream-50'
            }`}
          >
            {ETICHETTA_FILTRO[s]}
          </button>
        ))}
      </div>

      {/*
        La lettura è caduta: si ammette, non si disegna una tabella vuota sotto quattro zeri.
      */}
      {vista.avviso ? (
        <ErrorState
          title={vista.avviso.titolo}
          description={vista.avviso.dettaglio}
          retry={() => { void refetch(); }}
          supportHref={null}
        />
      ) : (
        <div className="bg-white border border-cream-300 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-cream-50 text-ink-600">
              <tr>
                <th className="text-left px-4 py-2">Prodotto / Seller</th>
                <th className="text-left px-4 py-2">Placement</th>
                <th className="text-left px-4 py-2">Periodo</th>
                <th className="text-right px-4 py-2">Budget/g</th>
                <th className="text-right px-4 py-2">Speso</th>
                <th className="text-right px-4 py-2">Impressions</th>
                <th className="text-right px-4 py-2">CTR</th>
                <th className="text-left px-4 py-2">Stato</th>
                <th className="text-right px-4 py-2">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-100">
              {vista.mostraScheletro ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-ink-500">{tStates('loading')}</td></tr>
              ) : vista.mostraVuoto ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-ink-500">{vista.frasePerTabellaVuota}</td></tr>
              ) : vista.campagne.map((l) => {
                const nome = nomeDellaCampagna(l);
                const ctr = l.impressions > 0 ? `${((l.clicks / l.impressions) * 100).toFixed(2)}%` : '—';
                return (
                  <tr key={l.id} className="hover:bg-cream-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink-900 text-sm">{l.product?.name ?? '—'}</p>
                      <p className="text-xs text-ink-500">{l.seller?.store_name ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{l.placement}{l.category_slug ? ` · ${l.category_slug}` : ''}</td>
                    <td className="px-4 py-3 text-ink-600 text-xs">
                      {formatDate(l.start_date)} → {formatDate(l.end_date)}
                    </td>
                    <td className="px-4 py-3 text-right">{formatPrice(l.daily_budget_cents / 100)}</td>
                    <td className="px-4 py-3 text-right">{formatPrice(l.spent_cents / 100)}</td>
                    <td className="px-4 py-3 text-right">{l.impressions.toLocaleString('it-IT')}</td>
                    <td className="px-4 py-3 text-right">{ctr}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_BADGE[l.status]}`}>{etichettaStato(l.status)}</span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                      {l.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => setStatus.mutate({ campagna: l, status: 'paused' })}
                          disabled={inCorso}
                          aria-label={`Metti in pausa la campagna «${nome}»`}
                          className="text-accent-700 hover:text-accent-800 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1"
                        >
                          <Pause size={12} strokeWidth={2.4} aria-hidden /> Pausa
                        </button>
                      )}
                      {l.status === 'paused' && (
                        <button
                          type="button"
                          onClick={() => setStatus.mutate({ campagna: l, status: 'active' })}
                          disabled={inCorso}
                          aria-label={`Riprendi la campagna «${nome}»`}
                          className="text-olive-700 hover:text-olive-800 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1"
                        >
                          <Play size={12} strokeWidth={2.4} aria-hidden /> Riprendi
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => del.mutate(l)}
                        disabled={inCorso}
                        aria-label={`Elimina la campagna «${nome}»`}
                        className="text-secondary-600 hover:text-secondary-700 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <Trash2 size={12} strokeWidth={2.4} aria-hidden /> Elimina
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { RefreshCw, ExternalLink, Clock, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import type { ExternalData } from '@/lib/products/externalSyncShared';

type Props = {
  productId: string;
  marketplace: string | null;
  sourceUrl: string | null;
  syncedAt: string | null;
  external: ExternalData | null;
  ttlMs?: number;
  onRefreshed?: (data: ExternalData) => void;
};

function relative(iso: string | null): string {
  if (!iso) return 'mai';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '—';
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'adesso';
  if (min < 60) return `${min} min fa`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h fa`;
  return `${Math.floor(h / 24)} g fa`;
}

const DEFAULT_TTL = 6 * 60 * 60 * 1000;

/**
 * Pannello dati esterni (admin): mostra prezzo/consegna/disponibilità
 * importati dal marketplace, con stato di sincronizzazione e un bottone per
 * forzare l'aggiornamento in tempo reale.
 */
export default function ExternalDataPanel({
  productId, marketplace, sourceUrl, syncedAt, external, ttlMs = DEFAULT_TTL, onRefreshed,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ExternalData | null>(external);
  const [synced, setSynced] = useState<string | null>(syncedAt);

  const stale = !synced || Date.now() - new Date(synced).getTime() >= ttlMs;

  const refresh = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/products/${productId}/external-refresh`, {
        method: 'POST',
        headers: { ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}) },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? 'Aggiornamento non riuscito');
      const fresh = body.data.external as ExternalData;
      setData(fresh);
      setSynced(body.data.synced_at ?? new Date().toISOString());
      onRefreshed?.(fresh);
      toast.success('Dati aggiornati dal marketplace');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-cream-300 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-ink-900 flex items-center gap-1.5">
          <Truck size={16} strokeWidth={2.2} aria-hidden /> Dati marketplace
          {marketplace && (
            <span className="ml-1 rounded-full bg-accent-100 text-accent-700 px-2 py-0.5 text-[11px] font-semibold uppercase">
              {marketplace}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-700 hover:text-primary-900 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden /> Aggiorna ora
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-ink-500">Prezzo marketplace</dt>
          <dd className="font-semibold text-ink-900">{data?.price != null ? formatPrice(data.price) : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">Tempo di consegna</dt>
          <dd className="font-semibold text-ink-900">{data?.delivery_label ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">Disponibilità</dt>
          <dd className="text-ink-800">
            {data?.availability === 'in_stock' ? 'Disponibile' : data?.availability === 'out_of_stock' ? 'Esaurito' : 'Sconosciuta'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500 flex items-center gap-1"><Clock size={11} aria-hidden /> Sincronizzato</dt>
          <dd className={stale ? 'text-amber-700 font-medium' : 'text-ink-800'}>
            {relative(synced)}{stale ? ' · da aggiornare' : ''}
          </dd>
        </div>
      </dl>

      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary-700 hover:underline break-all"
        >
          <ExternalLink size={13} aria-hidden /> Vedi annuncio originale
        </a>
      )}
    </div>
  );
}

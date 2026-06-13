'use client';

import { useState } from 'react';
import { Link2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';

export type ImportedExternal = {
  marketplace: 'ebay' | 'amazon' | 'aliexpress' | 'other';
  source_url: string | null;
  price: number | null;
  currency: string | null;
  delivery_min_days: number | null;
  delivery_max_days: number | null;
  delivery_label: string | null;
  availability: string;
  source_title: string | null;
  fetched_at: string;
};

export type ImportResult = {
  name: string;
  description: string;
  category_id: string | null;
  subcategory_id: string | null;
  category_slug: string;
  suggested_price: number | null;
  currency: string | null;
  image_urls: string[];
  attributes: Record<string, string>;
  tags: string[];
  external: ImportedExternal;
  confidence: number | null;
};

const MARKETPLACE_OPTIONS = [
  { value: '', label: 'Rileva automaticamente' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'ebay', label: 'eBay' },
  { value: 'aliexpress', label: 'AliExpress' },
  { value: 'other', label: 'Altro' },
] as const;

/**
 * Box "Importa da link": l'utente incolla un link (o nome) di un prodotto
 * Amazon/eBay/… e Claude + web_search recuperano tutti i dati identici, incluso
 * il tempo di consegna. Usato sia nel form seller che in quello admin.
 */
export default function ImportFromUrlBox({ onImported }: { onImported: (data: ImportResult) => void }) {
  const [query, setQuery] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [loading, setLoading] = useState(false);

  const run = async () => {
    const q = query.trim();
    if (q.length < 3 || loading) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/marketplace/import-fetch', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ query: q, ...(marketplace ? { marketplace } : {}) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? 'Import non riuscito');
      }
      onImported(body.data as ImportResult);
      toast.success('Dati importati: controlla e pubblica');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore durante l\'import');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50/60 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-primary-800">
        <Sparkles size={16} strokeWidth={2.4} aria-hidden /> Importa da Amazon / eBay
      </div>
      <p className="text-xs text-ink-600">
        Incolla il link del prodotto (o il nome): recuperiamo nome, descrizione, prezzo, foto,
        caratteristiche e il <strong>tempo di consegna</strong> del marketplace.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 flex items-center gap-2 rounded-lg border border-cream-300 bg-white px-3">
          <Link2 size={16} className="text-ink-400 shrink-0" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void run(); } }}
            placeholder="https://www.amazon.it/… oppure nome prodotto"
            className="flex-1 py-2.5 text-sm focus:outline-none bg-transparent"
          />
        </div>
        <select
          value={marketplace}
          onChange={(e) => setMarketplace(e.target.value)}
          aria-label="Marketplace"
          className="rounded-lg border border-cream-300 bg-white px-3 py-2.5 text-sm"
        >
          {MARKETPLACE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Button type="button" onClick={() => void run()} loading={loading} disabled={query.trim().length < 3}>
          Importa
        </Button>
      </div>
    </div>
  );
}

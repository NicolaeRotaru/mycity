'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, Sparkles, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';

const PER_DAY_EUR = 0.7; // €4,90 / 7 giorni
const DURATIONS = [7, 14, 30];

type Product = { id: string; name: string; price: number | string; images: string[] | null; status: string };
type Campaign = {
  id: string;
  product_id: string | null;
  start_date: string;
  end_date: string;
  status: 'active' | 'paused' | 'ended';
  impressions: number;
  clicks: number;
  product: { name: string | null } | null;
};

export default function SellerPromotePage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('sponsor');
    if (p === 'success') {
      toast.success('Pagamento riuscito! La sponsorizzazione è attiva.');
      window.history.replaceState({}, '', '/seller/promote');
    } else if (p === 'canceled') {
      toast.info('Pagamento annullato.');
      window.history.replaceState({}, '', '/seller/promote');
    }
  }, []);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['seller', 'promote', 'products'],
    queryFn: async (): Promise<Product[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data } = await supabase
        .from('products')
        .select('id, name, price, images, status')
        .eq('seller_id', user.id)
        .eq('status', 'available')
        .order('created_at', { ascending: false });
      return (data ?? []) as Product[];
    },
  });

  const { data: campaigns = [] } = useQuery({
    queryKey: ['seller', 'promote', 'campaigns'],
    queryFn: async (): Promise<Campaign[]> => {
      const { data } = await supabase
        .from('sponsored_listings')
        .select('id, product_id, start_date, end_date, status, impressions, clicks, product:products!sponsored_listings_product_id_fkey(name)')
        .order('created_at', { ascending: false })
        .limit(20);
      return (data ?? []) as unknown as Campaign[];
    },
  });

  const price = days * PER_DAY_EUR;

  const pay = async () => {
    if (!selected) { toast.error('Scegli un prodotto da sponsorizzare'); return; }
    setPaying(true);
    try {
      const res = await fetch('/api/sponsored/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: selected, days }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || 'Errore nel pagamento');
      window.location.href = json.url as string;
    } catch (e) {
      toast.error(friendlyError(e));
      setPaying(false);
    }
  };

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink-900 flex items-center gap-2">
          <Megaphone size={22} className="text-primary-700" strokeWidth={2.2} />
          Metti in primo piano
        </h1>
        <p className="text-sm text-ink-500 mt-1">
          Fai apparire un tuo prodotto nel carosello <strong>&laquo;In primo piano&raquo;</strong> della ricerca. €4,90 / 7 giorni.
        </p>
      </header>

      {/* Selezione prodotto */}
      <div className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm space-y-4">
        <h2 className="font-semibold text-ink-900">1. Scegli il prodotto</h2>
        {products.length === 0 ? (
          <p className="text-sm text-ink-500">Non hai prodotti in vendita da sponsorizzare.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {products.map((p) => {
              const img = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
              const active = selected === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p.id)}
                  className={`text-left rounded-xl border-2 overflow-hidden transition-colors ${
                    active ? 'border-primary-600 ring-2 ring-primary-200' : 'border-cream-300 hover:border-primary-300'
                  }`}
                >
                  <div className="relative aspect-square bg-cream-100">
                    {img && <Image src={sizedImage(img, 'thumb')} alt={p.name} fill sizes="144px" unoptimized className="object-cover" />}
                    {active && <span className="absolute top-1 right-1 bg-primary-600 text-white rounded-full p-1"><Sparkles size={12} /></span>}
                  </div>
                  <div className="p-2">
                    <p className="text-sm font-semibold text-ink-900 line-clamp-2">{p.name}</p>
                    <p className="text-sm font-bold text-primary-700">{formatPrice(p.price)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Durata + pagamento */}
      <div className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm space-y-4">
        <h2 className="font-semibold text-ink-900">2. Durata</h2>
        <div className="grid grid-cols-3 gap-2 max-w-md">
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`py-3 rounded-xl font-bold border-2 transition-colors ${
                days === d ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-ink-900 border-cream-300 hover:border-primary-300'
              }`}
            >
              {d} giorni
              <span className="block text-xs font-semibold opacity-80">{formatPrice(d * PER_DAY_EUR)}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-ink-600">Totale</span>
          <span className="text-2xl font-serif font-bold text-ink-900">{formatPrice(price)}</span>
        </div>
        <Button onClick={pay} loading={paying} disabled={!selected} fullWidth size="lg" icon={Megaphone}>
          Sponsorizza e paga {formatPrice(price)}
        </Button>
      </div>

      {/* Campagne */}
      {campaigns.length > 0 && (
        <div className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm">
          <h2 className="font-semibold text-ink-900 mb-3 flex items-center gap-2">
            <TrendingUp size={18} className="text-primary-600" /> Le tue campagne
          </h2>
          <div className="divide-y divide-cream-200">
            {campaigns.map((c) => (
              <div key={c.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900 truncate">{c.product?.name ?? '—'}</p>
                  <p className="text-xs text-ink-500">{c.start_date} → {c.end_date}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-ink-500">{c.impressions.toLocaleString('it-IT')} viste · {c.clicks} click</p>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                    c.status === 'active' ? 'bg-olive-100 text-olive-800' : c.status === 'paused' ? 'bg-accent-100 text-accent-800' : 'bg-cream-100 text-ink-600'
                  }`}>{c.status === 'active' ? 'Attiva' : c.status === 'paused' ? 'In pausa' : 'Conclusa'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

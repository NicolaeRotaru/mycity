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
import { Card } from '@/components/ui/Card';
import SellerPageTitle from '@/components/seller/SellerPageTitle';

const PER_WEEK_EUR = 4.99;
const DURATIONS = [1, 2, 4]; // settimane

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
  const [weeks, setWeeks] = useState(1);
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

  const price = weeks * PER_WEEK_EUR;

  const pay = async () => {
    if (!selected) { toast.error('Scegli un prodotto da sponsorizzare'); return; }
    setPaying(true);
    try {
      const res = await fetch('/api/sponsored/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: selected, weeks }),
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

  const selectedProduct = products.find((p) => p.id === selected) ?? null;

  return (
    <div>
      <SellerPageTitle
        eyebrow="Crescita"
        title="Sponsorizza"
        sub="Fai apparire un tuo prodotto nel carosello «In primo piano» della ricerca. €4,99 / settimana."
      />

      {/* Wizard 2 colonne: a sinistra la scelta, a destra durata + riepilogo */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.5fr_1fr]">
        {/* Selezione prodotto */}
        <Card variant="elevated" padding="lg" className="space-y-4">
          <h2 className="flex items-center gap-2 font-serif text-lg font-bold text-ink-900">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">1</span>
            Scegli il prodotto
          </h2>
          {products.length === 0 ? (
            <p className="text-sm text-ink-500">Non hai prodotti in vendita da sponsorizzare.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {products.map((p) => {
                const img = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
                const active = selected === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelected(p.id)}
                    aria-pressed={active}
                    className={`overflow-hidden rounded-xl border-2 text-left transition-colors ${
                      active ? 'border-primary-600 ring-2 ring-primary-200' : 'border-cream-300 hover:border-primary-300'
                    }`}
                  >
                    <div className="relative aspect-square bg-cream-100">
                      {img && <Image src={sizedImage(img, 'thumb')} alt={p.name} fill sizes="144px" unoptimized className="object-cover" />}
                      {active && <span className="absolute right-1 top-1 rounded-full bg-primary-600 p-1 text-white"><Sparkles size={12} aria-hidden /></span>}
                    </div>
                    <div className="p-2">
                      <p className="line-clamp-2 text-sm font-semibold text-ink-900">{p.name}</p>
                      <p className="text-sm font-bold text-primary-700">{formatPrice(p.price)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {/* Durata + pagamento (sticky su desktop) */}
        <Card variant="elevated" padding="lg" className="space-y-4 lg:sticky lg:top-24">
          <h2 className="flex items-center gap-2 font-serif text-lg font-bold text-ink-900">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">2</span>
            Durata
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {DURATIONS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWeeks(w)}
                aria-pressed={weeks === w}
                className={`rounded-xl border-2 py-3 font-bold transition-colors ${
                  weeks === w ? 'border-primary-600 bg-primary-600 text-white' : 'border-cream-300 bg-white text-ink-900 hover:border-primary-300'
                }`}
              >
                {w} {w === 1 ? 'sett.' : 'sett.'}
                <span className="block text-xs font-semibold opacity-80">{formatPrice(w * PER_WEEK_EUR)}</span>
              </button>
            ))}
          </div>

          <div className="rounded-lg bg-cream-50 px-3 py-2.5 text-sm">
            {selectedProduct ? (
              <p className="text-ink-600">Sponsorizzi <strong className="text-ink-900">{selectedProduct.name}</strong> per {weeks} {weeks === 1 ? 'settimana' : 'settimane'}.</p>
            ) : (
              <p className="text-ink-500">Scegli un prodotto a sinistra per continuare.</p>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-cream-200 pt-3">
            <span className="text-ink-600">Totale</span>
            <span className="font-serif text-2xl font-bold text-ink-900">{formatPrice(price)}</span>
          </div>
          <Button onClick={pay} loading={paying} disabled={!selected} fullWidth size="lg" icon={Megaphone}>
            Sponsorizza e paga {formatPrice(price)}
          </Button>
        </Card>
      </div>

      {/* Campagne */}
      {campaigns.length > 0 && (
        <Card variant="elevated" padding="lg" className="mt-5">
          <h2 className="mb-3 flex items-center gap-2 font-serif text-lg font-bold text-ink-900">
            <TrendingUp size={18} className="text-primary-600" aria-hidden /> Le tue campagne
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
        </Card>
      )}
    </div>
  );
}

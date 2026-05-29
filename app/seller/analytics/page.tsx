'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Eye, ShoppingCart, Star, ArrowLeft, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { useRouter } from 'next/navigation';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

export default function SellerAnalyticsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/sign-in?returnTo=/seller/analytics'); return; }
      setUserId(data.user.id);
    });
  }, [router]);

  const { data: analytics, isLoading } = useQuery({
    queryKey: queryKeys.seller.analytics(userId ?? ''),
    enabled: !!userId,
    queryFn: async () => {
      const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const since7 = new Date(Date.now() - 7 * 86400000).toISOString();

      // Prodotti del seller
      const { data: products } = await supabase
        .from('products')
        .select('id, name, price, images, status, created_at')
        .eq('seller_id', userId!);

      const productIds = (products ?? []).map((p) => p.id);
      if (productIds.length === 0) {
        return {
          views30: 0, views7: 0, viewsToday: 0,
          orders30: 0, orders7: 0,
          revenue30: 0, revenue7: 0,
          conversionRate: 0,
          avgRating: 0, reviewCount: 0,
          topProducts: [],
          slowProducts: [],
        };
      }

      const [viewsRes, ordersRes, reviewsRes] = await Promise.all([
        supabase
          .from('product_views')
          .select('product_id, viewed_at')
          .in('product_id', productIds)
          .gte('viewed_at', since30),
        supabase
          .from('orders')
          .select('id, total_price, delivery_status, created_at')
          .eq('seller_id', userId!)
          .gte('created_at', since30),
        supabase
          .from('reviews')
          .select('product_id, rating')
          .in('product_id', productIds),
      ]);

      const views = (viewsRes.data ?? []) as Array<{ product_id: string; viewed_at: string }>;
      const orders = (ordersRes.data ?? []) as Array<{ id: string; total_price: number; delivery_status: string; created_at: string }>;
      const reviews = (reviewsRes.data ?? []) as Array<{ product_id: string; rating: number }>;

      const views30 = views.length;
      const views7 = views.filter((v) => v.viewed_at >= since7).length;
      const todayStr = new Date().toISOString().slice(0, 10);
      const viewsToday = views.filter((v) => v.viewed_at.startsWith(todayStr)).length;

      const orders30 = orders.length;
      const orders7 = orders.filter((o) => o.created_at >= since7).length;
      const revenue30 = orders.filter((o) => o.delivery_status === 'DELIVERED')
        .reduce((s, o) => s + Number(o.total_price || 0), 0);
      const revenue7 = orders.filter((o) => o.created_at >= since7 && o.delivery_status === 'DELIVERED')
        .reduce((s, o) => s + Number(o.total_price || 0), 0);

      const conversionRate = views30 > 0 ? (orders30 / views30) * 100 : 0;

      const avgRating = reviews.length > 0
        ? reviews.reduce((s, r) => s + Number(r.rating), 0) / reviews.length
        : 0;

      // Top products by views
      const viewsByProduct: Record<string, number> = {};
      for (const v of views) viewsByProduct[v.product_id] = (viewsByProduct[v.product_id] ?? 0) + 1;
      const productMap = new Map((products ?? []).map((p) => [p.id, p]));
      const topProducts = Object.entries(viewsByProduct)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, count]) => ({ ...productMap.get(id), views: count }))
        .filter((p) => p.id);

      // Slow products (publicati ma pochi/zero view)
      const slowProducts = (products ?? [])
        .filter((p) => p.status === 'available')
        .map((p) => ({ ...p, views: viewsByProduct[p.id] ?? 0 }))
        .sort((a, b) => a.views - b.views)
        .slice(0, 3);

      return { views30, views7, viewsToday, orders30, orders7, revenue30, revenue7, conversionRate, avgRating, reviewCount: reviews.length, topProducts, slowProducts };
    },
  });

  if (!userId || isLoading) return <LoadingState />;
  if (!analytics) return null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/seller/dashboard" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
          <ArrowLeft size={14} /> Dashboard
        </Link>
        <h1 className="text-3xl font-serif font-bold mt-2 text-ink-900 flex items-center gap-2">
          <TrendingUp size={28} className="text-primary-600" />
          Analytics
        </h1>
        <p className="text-sm text-ink-500 mt-1">Performance del tuo negozio negli ultimi 30 giorni</p>
      </div>

      {/* KPI hero */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Eye />}
          label="Visite (30gg)"
          value={analytics.views30.toString()}
          delta={`${analytics.viewsToday} oggi · ${analytics.views7} ultimi 7gg`}
          color="primary"
        />
        <KpiCard
          icon={<ShoppingCart />}
          label="Ordini (30gg)"
          value={analytics.orders30.toString()}
          delta={`${analytics.orders7} ultimi 7gg`}
          color="olive"
        />
        <KpiCard
          icon={<TrendingUp />}
          label="Conversion rate"
          value={`${analytics.conversionRate.toFixed(1)}%`}
          delta={analytics.conversionRate >= 2 ? '✓ Sopra la media' : analytics.conversionRate >= 1 ? '~ Nella media' : '✗ Sotto la media'}
          color={analytics.conversionRate >= 2 ? 'olive' : analytics.conversionRate >= 1 ? 'accent' : 'secondary'}
        />
        <KpiCard
          icon={<Star />}
          label="Rating medio"
          value={analytics.avgRating > 0 ? analytics.avgRating.toFixed(1) + ' ★' : '—'}
          delta={analytics.reviewCount > 0 ? `${analytics.reviewCount} recensioni` : 'Nessuna recensione'}
          color="accent"
        />
      </div>

      {/* Revenue grande */}
      <div className="bg-gradient-to-br from-primary-700 to-secondary-700 text-white rounded-2xl p-6 shadow-warm-lg">
        <p className="text-xs uppercase tracking-wider opacity-80">Fatturato 30 giorni</p>
        <p className="text-5xl font-serif font-extrabold mt-2">{formatPrice(analytics.revenue30)}</p>
        <p className="text-sm opacity-90 mt-2">Ultimi 7 giorni: <strong>{formatPrice(analytics.revenue7)}</strong></p>
      </div>

      {/* Top products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm">
          <h2 className="font-serif font-bold text-lg text-ink-900 mb-3 flex items-center gap-2">
            <TrendingUp size={20} className="text-olive-600" />
            Top 5 prodotti
          </h2>
          {analytics.topProducts.length === 0 ? (
            <p className="text-sm text-ink-500">Nessuna view ancora.</p>
          ) : (
            <div className="space-y-2">
              {analytics.topProducts.map((p, i: number) => (
                <Link key={p.id} href={`/product/${p.id}`} className="flex items-center gap-3 p-2 hover:bg-cream-50 rounded-lg">
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                    i === 0 ? 'bg-accent-500 text-ink-900' : 'bg-cream-200 text-ink-700'
                  }`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink-900 truncate">{p.name}</p>
                    <p className="text-xs text-ink-500">{formatPrice(p.price)}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-primary-700">
                    <Eye size={14} />
                    {p.views}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm">
          <h2 className="font-serif font-bold text-lg text-ink-900 mb-3 flex items-center gap-2">
            <Sparkles size={20} className="text-accent-600" />
            Da migliorare
          </h2>
          {analytics.slowProducts.length === 0 ? (
            <p className="text-sm text-ink-500">Niente da segnalare. Bel lavoro!</p>
          ) : (
            <div className="space-y-2">
              {analytics.slowProducts.map((p) => (
                <div key={p.id} className="p-3 bg-secondary-50 border border-secondary-200 rounded-lg">
                  <p className="text-sm font-semibold text-ink-900 truncate">{p.name}</p>
                  <p className="text-xs text-ink-600 mt-1">
                    Solo {p.views} {p.views === 1 ? 'visita' : 'visite'} in 30gg. Prova ad aggiungere foto migliori o descrizione più ricca.
                  </p>
                  <Link href={`/seller/products/${p.id}/edit`} className="text-xs font-semibold text-primary-700 hover:underline mt-2 inline-block">
                    Modifica prodotto →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, delta, color }: { icon: React.ReactNode; label: string; value: string; delta?: string; color: string }) {
  const bg =
    color === 'primary' ? 'bg-primary-100 text-primary-700' :
    color === 'olive' ? 'bg-olive-100 text-olive-700' :
    color === 'accent' ? 'bg-accent-100 text-accent-700' :
    'bg-secondary-100 text-secondary-700';
  return (
    <div className="bg-white border border-cream-300 rounded-2xl p-4 shadow-warm">
      <div className={`inline-flex w-10 h-10 rounded-xl ${bg} items-center justify-center mb-2`}>{icon}</div>
      <p className="text-xs text-ink-500 uppercase tracking-wider font-semibold">{label}</p>
      <p className="text-2xl font-serif font-bold text-ink-900 mt-1">{value}</p>
      {delta && <p className="text-xs text-ink-500 mt-1">{delta}</p>}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Eye, ShoppingCart, Star, Sparkles, Lightbulb, PackageX, type LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { useRouter } from 'next/navigation';
import { LoadingState } from '@/components/ui/LoadingState';
import { Card } from '@/components/ui/Card';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import { queryKeys } from '@/lib/queries/keys';

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

type Insight = { icon: LucideIcon; tone: 'olive' | 'secondary' | 'accent'; title: string; body: string; ctaLabel: string; ctaHref: string };

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
        .select('id, name, price, images, status, stock, created_at')
        .eq('seller_id', userId!);

      const productIds = (products ?? []).map((p) => p.id);
      const empty = {
        views30: 0, views7: 0, viewsToday: 0,
        orders30: 0, orders7: 0,
        revenue30: 0, revenue7: 0,
        conversionRate: 0,
        avgRating: 0, reviewCount: 0,
        topProducts: [] as Array<{ id: string; name?: string; price?: number; views: number }>,
        slowProducts: [] as Array<{ id: string; name?: string; views: number }>,
        revenueSeries: [] as Array<{ label: string; value: number }>,
        peakHours: [] as Array<{ label: string; value: number; pct: number }>,
        peakLabel: null as string | null,
      };
      if (productIds.length === 0) return empty;

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
        .filter((p) => p.id) as Array<{ id: string; name?: string; price?: number; views: number }>;

      // Slow products (publicati ma pochi/zero view)
      const slowProducts = (products ?? [])
        .filter((p) => p.status === 'available')
        .map((p) => ({ ...p, views: viewsByProduct[p.id] ?? 0 }))
        .sort((a, b) => a.views - b.views)
        .slice(0, 3) as Array<{ id: string; name?: string; views: number }>;

      // Serie ricavi ultimi 7 giorni (ordini consegnati, dato reale).
      const dayBuckets: { key: string; label: string; value: number }[] = [];
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        dayBuckets.push({ key: d.toISOString().slice(0, 10), label: DAY_LABELS[d.getDay()], value: 0 });
      }
      const dayIndex = new Map(dayBuckets.map((b, i) => [b.key, i]));
      for (const o of orders) {
        if (o.delivery_status !== 'DELIVERED') continue;
        const k = o.created_at.slice(0, 10);
        const i = dayIndex.get(k);
        if (i != null) dayBuckets[i].value += Number(o.total_price || 0);
      }
      const revenueSeries = dayBuckets.map((b) => ({ label: b.label, value: b.value }));

      // Ore di punta: distribuzione oraria reale degli ordini (30gg).
      const hourCounts = new Array(24).fill(0) as number[];
      for (const o of orders) hourCounts[new Date(o.created_at).getHours()] += 1;
      const maxHour = Math.max(...hourCounts, 0);
      let peakHours: Array<{ label: string; value: number; pct: number }> = [];
      let peakLabel: string | null = null;
      if (maxHour > 0) {
        // Mostra le 5 fasce orarie con più ordini.
        const ranked = hourCounts
          .map((value, hour) => ({ hour, value }))
          .filter((h) => h.value > 0)
          .sort((a, b) => b.value - a.value)
          .slice(0, 5)
          .sort((a, b) => a.hour - b.hour);
        peakHours = ranked.map((h) => ({
          label: `${h.hour}–${h.hour + 1}`,
          value: h.value,
          pct: Math.round((h.value / maxHour) * 100),
        }));
        const top = ranked.reduce((a, b) => (b.value > a.value ? b : a), ranked[0]);
        peakLabel = `${top.hour} e le ${top.hour + 1}`;
      }

      return { views30, views7, viewsToday, orders30, orders7, revenue30, revenue7, conversionRate, avgRating, reviewCount: reviews.length, topProducts, slowProducts, revenueSeries, peakHours, peakLabel };
    },
  });

  if (!userId || isLoading) return <LoadingState />;
  if (!analytics) return null;

  // "Consigli per te" — prescrittivi, derivati dai dati reali (top/slow products).
  const insights: Insight[] = [];
  const best = analytics.topProducts[0];
  if (best) {
    insights.push({
      icon: TrendingUp, tone: 'olive',
      title: `Spingi "${best.name ?? 'il tuo best-seller'}"`,
      body: `È il prodotto più visto (${best.views} ${best.views === 1 ? 'visita' : 'visite'} in 30gg). Sponsorizzalo per restare in cima alle ricerche.`,
      ctaLabel: 'Sponsorizza', ctaHref: '/seller/promote',
    });
  }
  const slow = analytics.slowProducts[0];
  if (slow) {
    insights.push({
      icon: TrendingDown, tone: 'accent',
      title: `"${slow.name ?? 'Un prodotto'}" vende poco`,
      body: `Solo ${slow.views} ${slow.views === 1 ? 'visita' : 'visite'} in 30gg. Prova uno sconto, una foto migliore o una descrizione più ricca.`,
      ctaLabel: 'Modifica prodotto', ctaHref: slow.id ? `/seller/products/${slow.id}/edit` : '/seller/products',
    });
  }
  if (analytics.conversionRate > 0 && analytics.conversionRate < 1) {
    insights.push({
      icon: PackageX, tone: 'secondary',
      title: 'Conversione sotto la media',
      body: `Tante visite ma pochi ordini (${analytics.conversionRate.toFixed(1)}%). Una promo a tempo può creare urgenza.`,
      ctaLabel: 'Crea una promo', ctaHref: '/seller/promotions',
    });
  }

  const maxRev = Math.max(...analytics.revenueSeries.map((d) => d.value), 1);

  return (
    <div>
      <SellerPageTitle eyebrow="Insight" title="Analisi" sub="Andamento delle vendite e prodotti migliori" />

      {/* Consigli per te */}
      {insights.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 inline-flex items-center gap-2 font-serif text-lg font-bold text-ink-900">
            <Sparkles size={18} className="text-primary-600" aria-hidden /> Consigli per te
          </h2>
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
            {insights.map((it, i) => <InsightCard key={i} {...it} />)}
          </div>
        </section>
      )}

      {/* KPI hero */}
      <div className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <KpiCard icon={Eye} label="Visite (30gg)" value={analytics.views30.toString()} delta={`${analytics.viewsToday} oggi · ${analytics.views7} ultimi 7gg`} color="primary" />
        <KpiCard icon={ShoppingCart} label="Ordini (30gg)" value={analytics.orders30.toString()} delta={`${analytics.orders7} ultimi 7gg`} color="olive" />
        <KpiCard icon={TrendingUp} label="Conversion rate" value={`${analytics.conversionRate.toFixed(1)}%`} delta={analytics.conversionRate >= 2 ? 'Sopra la media' : analytics.conversionRate >= 1 ? 'Nella media' : 'Sotto la media'} color={analytics.conversionRate >= 2 ? 'olive' : analytics.conversionRate >= 1 ? 'accent' : 'secondary'} />
        <KpiCard icon={Star} label="Rating medio" value={analytics.avgRating > 0 ? analytics.avgRating.toFixed(1) + ' ★' : '—'} delta={analytics.reviewCount > 0 ? `${analytics.reviewCount} recensioni` : 'Nessuna recensione'} color="accent" />
      </div>

      {/* Revenue grande */}
      <div className="mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-primary-700 to-secondary-700 p-6 text-white shadow-warm-lg">
        <p className="text-xs uppercase tracking-wider opacity-80">Fatturato 30 giorni</p>
        <p className="mt-2 font-serif text-4xl font-extrabold sm:text-5xl">{formatPrice(analytics.revenue30)}</p>
        <p className="mt-2 text-sm opacity-90">Ultimi 7 giorni: <strong>{formatPrice(analytics.revenue7)}</strong></p>
      </div>

      {/* Grafico 7gg + top prodotti */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card variant="bordered" padding="lg">
          <h2 className="mb-4 font-serif text-lg font-bold text-ink-900">Fatturato · ultimi 7 giorni</h2>
          <div className="flex h-44 items-end gap-3">
            {analytics.revenueSeries.map((d, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center gap-2">
                <div className="flex w-full flex-1 items-end">
                  <div
                    title={formatPrice(d.value)}
                    className="w-full rounded-t bg-gradient-to-b from-primary-500 to-primary-700"
                    style={{ height: `${Math.max((d.value / maxRev) * 100, d.value > 0 ? 6 : 2)}%` }}
                  />
                </div>
                <span className="text-[11px] text-ink-500">{d.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="bordered" padding="lg">
          <h2 className="mb-4 font-serif text-lg font-bold text-ink-900">Prodotti più visti</h2>
          {analytics.topProducts.length === 0 ? (
            <p className="text-sm text-ink-500">Nessuna visita ancora.</p>
          ) : (
            <div className="space-y-3.5">
              {analytics.topProducts.map((p, i) => {
                const maxViews = analytics.topProducts[0].views || 1;
                return (
                  <Link key={p.id} href={`/product/${p.id}`} className="flex items-center gap-2.5">
                    <span className="w-4 text-[13px] font-extrabold text-ink-300">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-ink-900">{p.name}</p>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cream-200">
                        <span className="block h-full rounded-full bg-olive-500" style={{ width: `${(p.views / maxViews) * 100}%` }} />
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[13px] font-bold text-ink-700">
                      <Eye size={13} aria-hidden /> {p.views}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Ore di punta (dato reale) */}
      {analytics.peakHours.length > 0 && (
        <Card variant="bordered" padding="lg" className="mt-5">
          <h2 className="font-serif text-lg font-bold text-ink-900">Ore di punta</h2>
          <p className="mb-4 text-[13px] text-ink-500">Quando arrivano i tuoi ordini — assicurati di essere pronto e disponibile.</p>
          <div className="flex h-28 items-end gap-2.5">
            {analytics.peakHours.map((h) => (
              <div key={h.label} className="flex h-full flex-1 flex-col items-center gap-2">
                <div className="flex w-full flex-1 items-end">
                  <div
                    title={`${h.value} ordini`}
                    className={`w-full rounded-t ${h.pct >= 88 ? 'bg-gradient-to-b from-secondary-400 to-secondary-600' : 'bg-gradient-to-b from-accent-300 to-accent-500'}`}
                    style={{ height: `${Math.max(h.pct, 6)}%` }}
                  />
                </div>
                <span className="text-[11px] font-semibold text-ink-500">{h.label}</span>
              </div>
            ))}
          </div>
          {analytics.peakLabel && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-md bg-olive-50 px-3 py-2.5 text-[13px] text-olive-800">
              <Lightbulb size={15} className="text-olive-700" aria-hidden /> Picco tra le <strong>{analytics.peakLabel}</strong>: tieni il negozio online e lo stock pronto.
            </p>
          )}
        </Card>
      )}

      {/* Da migliorare */}
      {analytics.slowProducts.length > 0 && (
        <Card variant="bordered" padding="lg" className="mt-5">
          <h2 className="mb-3 inline-flex items-center gap-2 font-serif text-lg font-bold text-ink-900">
            <Sparkles size={18} className="text-accent-600" aria-hidden /> Da migliorare
          </h2>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {analytics.slowProducts.map((p) => (
              <div key={p.id} className="rounded-lg border border-secondary-200 bg-secondary-50 p-3">
                <p className="truncate text-sm font-semibold text-ink-900">{p.name}</p>
                <p className="mt-1 text-xs text-ink-600">
                  Solo {p.views} {p.views === 1 ? 'visita' : 'visite'} in 30gg. Prova foto migliori o una descrizione più ricca.
                </p>
                <Link href={`/seller/products/${p.id}/edit`} className="mt-2 inline-block text-xs font-semibold text-primary-700 hover:underline">
                  Modifica prodotto →
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

const INSIGHT_TONE: Record<Insight['tone'], { bg: string; border: string; fg: string; btn: string }> = {
  olive:     { bg: 'bg-olive-50',     border: 'border-olive-200',     fg: 'text-olive-700',     btn: 'bg-olive-600 hover:bg-olive-700' },
  secondary: { bg: 'bg-secondary-50', border: 'border-secondary-200', fg: 'text-secondary-600', btn: 'bg-secondary-600 hover:bg-secondary-700' },
  accent:    { bg: 'bg-accent-50',    border: 'border-accent-200',    fg: 'text-accent-700',    btn: 'bg-accent-600 hover:bg-accent-700 text-white' },
};

function InsightCard({ icon: Icon, tone, title, body, ctaLabel, ctaHref }: Insight) {
  const c = INSIGHT_TONE[tone];
  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-4`}>
      <span className="mb-2.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-0">
        <Icon size={18} className={c.fg} aria-hidden />
      </span>
      <p className="text-sm font-bold text-ink-900">{title}</p>
      <p className="mb-3 mt-1 text-[13px] leading-snug text-ink-600">{body}</p>
      <Link href={ctaHref} className={`inline-flex rounded-full px-3.5 py-2 text-[13px] font-bold text-white transition-colors ${c.btn}`}>
        {ctaLabel}
      </Link>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, delta, color }: { icon: LucideIcon; label: string; value: string; delta?: string; color: string }) {
  const bg =
    color === 'primary' ? 'bg-primary-100 text-primary-700' :
    color === 'olive' ? 'bg-olive-100 text-olive-700' :
    color === 'accent' ? 'bg-accent-100 text-accent-700' :
    'bg-secondary-100 text-secondary-600';
  return (
    <Card variant="bordered" padding="md">
      <div className={`mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl ${bg}`}>
        <Icon size={20} strokeWidth={2.2} aria-hidden />
      </div>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">{label}</p>
      <p className="mt-1 font-serif text-2xl font-bold text-ink-900">{value}</p>
      {delta && <p className="mt-1 text-xs text-ink-500">{delta}</p>}
    </Card>
  );
}

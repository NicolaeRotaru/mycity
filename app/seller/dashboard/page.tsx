'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, ExternalLink, Share2, ArrowRight, TrendingUp, Package, Star, Receipt,
  Tag, Camera, BarChart3, Users, Wallet, LayoutTemplate, Store, Upload, LifeBuoy,
  Megaphone, Landmark, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { useProfile } from '@/components/hooks/useProfile';
import StoreAvatar from '@/components/StoreAvatar';
import SellerHealthScore from '@/components/seller/SellerHealthScore';
import SellerOnboardingChecklist from '@/components/seller/SellerOnboardingChecklist';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { queryKeys } from '@/lib/queries/keys';

export default function SellerDashboard() {
  const { profile, isSeller } = useProfile();
  const queryClient = useQueryClient();

  // Feedback + sync al rientro da Stripe Connect onboarding. Il webhook
  // account.updated potrebbe non arrivare (es. endpoint non iscritto agli
  // eventi Connect): qui rileggiamo lo stato da Stripe e invalidiamo le viste
  // che lo mostrano, così checklist e Guadagni si aggiornano subito.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('stripe');
    if (s === 'connected') {
      (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          await fetch('/api/stripe/connect/refresh-status', {
            method: 'POST',
            headers: token ? { authorization: `Bearer ${token}` } : {},
          });
        } catch {
          /* il webhook resta come fallback */
        }
        queryClient.invalidateQueries({ queryKey: ['seller'] });
        toast.success('Configurazione pagamenti aggiornata!');
      })();
      window.history.replaceState({}, '', '/seller/dashboard');
    } else if (s === 'refresh') {
      toast('Configurazione interrotta. Riprova quando vuoi dalla pagina Guadagni.', { icon: <Landmark size={18} aria-hidden /> });
      window.history.replaceState({}, '', '/seller/dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: stats, isLoading } = useQuery({
    queryKey: queryKeys.seller.stats,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');

      const [{ count: productCount }, { count: availableCount }, { data: items }, { data: storeReviews }] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('seller_id', user.id),
        supabase.from('products').select('id', { count: 'exact', head: true })
          .eq('seller_id', user.id).eq('status', 'available'),
        supabase.from('order_items')
          .select('quantity, unit_price, orders(created_at), products!inner(seller_id)')
          .eq('products.seller_id', user.id),
        supabase.from('store_reviews').select('rating').eq('store_id', user.id),
      ]);

      type OrderItem = {
        unit_price: number | string;
        quantity: number;
        orders?: { created_at: string | null } | null;
      };
      const itemsArr = (items ?? []) as unknown as OrderItem[];
      const revenue = itemsArr.reduce((s, it) => s + Number(it.unit_price) * it.quantity, 0);

      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const startOf7d = new Date(Date.now() - 7 * 86400000);
      const startOf30d = new Date(Date.now() - 30 * 86400000);

      const inRange = (it: OrderItem, from: Date) => new Date(it.orders?.created_at ?? 0) >= from;
      const sum = (arr: OrderItem[]) => arr.reduce((s, it) => s + Number(it.unit_price) * it.quantity, 0);

      const today = itemsArr.filter((it) => inRange(it, startOfToday));
      const last7 = itemsArr.filter((it) => inRange(it, startOf7d));
      const last30 = itemsArr.filter((it) => inRange(it, startOf30d));

      type Review = { rating: number };
      const reviews = (storeReviews ?? []) as Review[];
      const avgRating = reviews.length > 0
        ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
        : 0;

      return {
        productCount: productCount ?? 0,
        availableCount: availableCount ?? 0,
        orderCount: itemsArr.length,
        revenue,
        revenueToday: sum(today),
        revenue7: sum(last7),
        revenue30: sum(last30),
        ordersToday: today.length,
        orders7: last7.length,
        last30Count: last30.length,
        avgRating,
        reviewCount: reviews.length,
      };
    },
    enabled: isSeller,
  });

  if (isLoading || !stats) return <LoadingState />;

  const storeName = profile?.store_name || 'il tuo negozio';
  const storeUrl = profile?.id ? `/store/${profile.id}` : null;

  const share = async () => {
    if (!profile?.id) return;
    const url = `${window.location.origin}/store/${profile.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: storeName, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success('Link della vetrina copiato!');
      }
    } catch { /* annullato dall'utente */ }
  };

  return (
    <div className="space-y-7">
      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-700 via-primary-600 to-secondary-700 text-white shadow-warm-lg">
        <div className="absolute -top-16 -right-10 w-64 h-64 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="absolute -bottom-20 -left-10 w-56 h-56 rounded-full bg-accent-400/20 blur-2xl" aria-hidden />

        <div className="relative p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-4">
            <StoreAvatar logoUrl={profile?.store_logo} storeName={profile?.store_name} size="lg" className="ring-4 ring-white/25 shadow-warm" />
            <div className="min-w-0 flex-1">
              <p className="text-white/75 text-sm">Bentornato</p>
              <h1 className="font-serif text-3xl sm:text-4xl font-bold leading-tight truncate">{storeName}</h1>
              <span className="inline-flex items-center gap-1.5 mt-1.5 text-xs font-semibold bg-olive-500/90 text-white rounded-full px-2.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Negozio attivo
              </span>
            </div>

            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <Button
                href="/seller/products/new"
                variant="secondary"
                icon={Plus}
                className="flex-1 sm:flex-none"
              >
                Pubblica prodotto
              </Button>
              {storeUrl && (
                <Link
                  href={storeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 bg-white/15 hover:bg-white/25 border border-white/25 text-white font-semibold px-4 py-2.5 rounded-xl transition-colors"
                >
                  <ExternalLink size={18} /> Vetrina
                </Link>
              )}
              {profile?.id && (
                <button
                  type="button"
                  onClick={share}
                  aria-label="Condividi la vetrina"
                  className="inline-flex items-center justify-center gap-2 bg-white/15 hover:bg-white/25 border border-white/25 text-white font-semibold px-3 py-2.5 rounded-xl transition-colors"
                >
                  <Share2 size={18} />
                </button>
              )}
            </div>
          </div>

          {/* Incassi per periodo */}
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3 mt-6">
            <HeroStat label="Oggi" value={formatPrice(stats.revenueToday)} sub={`${stats.ordersToday} articoli`} />
            <HeroStat label="7 giorni" value={formatPrice(stats.revenue7)} sub={`${stats.orders7} articoli`} />
            <HeroStat label="30 giorni" value={formatPrice(stats.revenue30)} sub={`${stats.last30Count} articoli`} />
          </div>
        </div>
      </section>

      {/* ===== Onboarding (si nasconde da solo al 100%) ===== */}
      <SellerOnboardingChecklist />

      {/* ===== KPI complessivi ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard icon={TrendingUp} tint={TINT.olive} label="Fatturato totale" value={formatPrice(stats.revenue)} hint={`${stats.orderCount} articoli venduti`} />
        <KpiCard icon={Package} tint={TINT.primary} label="Prodotti in vendita" value={stats.availableCount} hint={`su ${stats.productCount} totali`} />
        <KpiCard icon={Star} tint={TINT.accent} label="Valutazione media" value={stats.avgRating > 0 ? `${stats.avgRating.toFixed(1)} ★` : '—'} hint={stats.reviewCount > 0 ? `${stats.reviewCount} recensioni` : 'Nessuna recensione'} />
        <KpiCard icon={Receipt} tint={TINT.secondary} label="Articoli venduti" value={stats.orderCount} hint="Dall'inizio" />
      </div>

      {/* ===== HUB: ogni funzione, ogni pagina ===== */}
      <NavGroup title="Vendite" hint="Catalogo, ordini, marketing" tint={TINT.primary}>
        <NavTile href="/seller/products"   icon={Package}       title="Prodotti"   desc="Catalogo e disponibilità" meta={`${stats.availableCount} in vendita`} tint={TINT.primary} />
        <NavTile href="/seller/orders"     icon={Receipt}       title="Ordini"     desc="Prepara e gestisci" tint={TINT.primary} />
        <NavTile href="/seller/promotions" icon={Tag}           title="Promozioni" desc="Sconti e offerte" tint={TINT.primary} />
        <NavTile href="/seller/stories"    icon={Camera}        title="Storie"     desc="Contenuti 24h" tint={TINT.primary} />
      </NavGroup>

      <NavGroup title="Crescita" hint="Capisci i numeri e fai di più" tint={TINT.olive}>
        <NavTile href="/seller/analytics" icon={BarChart3} title="Analisi"    desc="Andamento e insight" tint={TINT.olive} />
        <NavTile href="/seller/customers" icon={Users}     title="Clienti"    desc="Chi compra da te" tint={TINT.olive} />
        <NavTile href="/seller/reviews"   icon={Star}      title="Recensioni" desc="Reputazione e feedback" meta={stats.reviewCount > 0 ? `${stats.reviewCount} totali` : undefined} tint={TINT.olive} />
        <NavTile href="/seller/earnings"  icon={Wallet}    title="Guadagni"   desc="Incassi e pagamenti" tint={TINT.olive} />
      </NavGroup>

      <NavGroup title="Il tuo negozio" hint="Vetrina, profilo, strumenti" tint={TINT.accent}>
        <NavTile href="/seller/site"            icon={LayoutTemplate} title="Costruisci il sito" desc="Vetrina e pagine" tint={TINT.accent} />
        <NavTile href="/seller/profile"         icon={Store}          title="Profilo negozio"    desc="Contatti e orari" tint={TINT.accent} />
        <NavTile href="/seller/products/import" icon={Upload}         title="Importa prodotti"   desc="Carica in massa (CSV)" tint={TINT.accent} />
        <NavTile href="/seller/help"            icon={LifeBuoy}       title="Centro venditori"   desc="Guide e assistenza" tint={TINT.accent} />
      </NavGroup>

      {/* ===== Health score + crescita ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start min-w-0">
        <SellerHealthScore />
        <div className="bg-white border border-cream-300 rounded-2xl p-6 shadow-warm">
          <h2 className="font-serif text-xl font-bold text-ink-900 flex items-center gap-2">
            <Megaphone size={20} className="text-accent-600" /> Fai crescere le vendite
          </h2>
          <p className="text-sm text-ink-500 mt-1 mb-4">Tre mosse semplici per portare più clienti.</p>
          <ul className="space-y-2.5">
            {stats.availableCount < 8 && (
              <TipRow href="/seller/products/new" icon={Plus} title="Aggiungi prodotti" desc="I negozi con +10 articoli vendono il 70% in più." />
            )}
            <TipRow href="/seller/promotions" icon={Tag} title="Lancia una promo" desc="Uno sconto a tempo crea urgenza e fa salire le vendite." />
            <TipRow href="/seller/stories" icon={Camera} title="Pubblica una storia" desc="Le storie (24h) portano i clienti dentro al tuo negozio." />
            {storeUrl && (
              <TipRow href={storeUrl} external icon={Share2} title="Condividi la vetrina" desc="Manda il link a clienti e amici per farti conoscere." />
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ============================ helpers ============================ */

type Tint = { bg: string; fg: string; ring: string };
const TINT: Record<'primary' | 'olive' | 'accent' | 'secondary', Tint> = {
  primary:   { bg: 'bg-primary-100',   fg: 'text-primary-700',   ring: 'group-hover:border-primary-300' },
  olive:     { bg: 'bg-olive-100',     fg: 'text-olive-700',     ring: 'group-hover:border-olive-300' },
  accent:    { bg: 'bg-accent-100',    fg: 'text-accent-700',    ring: 'group-hover:border-accent-300' },
  secondary: { bg: 'bg-secondary-100', fg: 'text-secondary-700', ring: 'group-hover:border-secondary-300' },
};

function HeroStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl bg-white/10 backdrop-blur-sm border border-white/15 px-3 py-2.5 sm:px-4 sm:py-3">
      <p className="text-[11px] uppercase tracking-wide text-white/70 font-semibold">{label}</p>
      <p className="text-lg sm:text-2xl font-bold leading-tight mt-0.5">{value}</p>
      <p className="text-[11px] text-white/60">{sub}</p>
    </div>
  );
}

function KpiCard({ icon: Icon, tint, label, value, hint }: {
  icon: LucideIcon; tint: Tint; label: string; value: string | number; hint?: string;
}) {
  return (
    <div className="bg-white border border-cream-300 rounded-2xl p-4 sm:p-5 shadow-warm-sm">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tint.bg} ${tint.fg}`}>
        <Icon size={20} strokeWidth={2.2} />
      </div>
      <p className="text-2xl font-bold text-ink-900 mt-3 leading-none">{value}</p>
      <p className="text-sm text-ink-600 mt-1.5">{label}</p>
      {hint && <p className="text-xs text-ink-400 mt-1">{hint}</p>}
    </div>
  );
}

function NavGroup({ title, hint, children }: { title: string; hint: string; tint: Tint; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-serif text-xl font-bold text-ink-900">{title}</h2>
        <span className="text-sm text-ink-400">{hint}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">{children}</div>
    </section>
  );
}

function NavTile({ href, icon: Icon, title, desc, meta, tint, external }: {
  href: string; icon: LucideIcon; title: string; desc: string; meta?: string; tint: Tint; external?: boolean;
}) {
  return (
    <Link
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className={`group bg-white border border-cream-300 rounded-2xl p-4 flex items-start gap-3 transition-all hover:shadow-warm ${tint.ring}`}
    >
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tint.bg} ${tint.fg}`}>
        <Icon size={21} strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-ink-900 truncate">{title}</p>
          <ArrowRight size={16} className="text-ink-300 shrink-0 transition-all group-hover:text-primary-600 group-hover:translate-x-0.5" />
        </div>
        <p className="text-sm text-ink-500 leading-snug">{desc}</p>
        {meta && <p className="text-xs font-semibold text-ink-400 mt-1">{meta}</p>}
      </div>
    </Link>
  );
}

function TipRow({ href, icon: Icon, title, desc, external }: {
  href: string; icon: LucideIcon; title: string; desc: string; external?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className="group flex items-start gap-3 rounded-xl p-2.5 -mx-1 hover:bg-cream-50 transition-colors"
      >
        <div className="w-9 h-9 rounded-lg bg-accent-100 text-accent-700 flex items-center justify-center shrink-0">
          <Icon size={18} strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-900">{title}</p>
          <p className="text-xs text-ink-500 leading-snug">{desc}</p>
        </div>
        <ArrowRight size={15} className="text-ink-300 shrink-0 mt-1 transition-all group-hover:text-accent-600 group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

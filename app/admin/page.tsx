'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import {
  Users, ShoppingCart, Store, Bike, Shield, Package, TrendingUp,
  CheckCircle2, Banknote, ShoppingBag, LayoutGrid, Activity, Euro, Percent, Timer, Info,
  CreditCard,
  type LucideIcon,
} from 'lucide-react';
import { formatPrice } from '@/lib/format';
import { MARKETPLACE_FEE_BPS } from '@/lib/constants';
import { ORDER_STATUS_LABEL, ORDER_STATUS_ICON, type OrderStatus } from '@/lib/order-status';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import { getAccountMenuItems } from '@/lib/account-menu';
import { tassoAutorizzazione, tassoDaGuardare, type TentativoPagamento } from '@/lib/pagamenti/tasso-autorizzazione';
import { AdminPageTitle, AdminSectionLabel, AdminStatCard } from '@/components/admin/AdminUI';

// Qui c'era `const TAKE_RATE = 0.14` scritto a mano, mentre la commissione
// trattenuta e' il 10% (MARKETPLACE_FEE_BPS in lib/constants) e le Condizioni
// d'uso dicevano un terzo numero, l'8%. Tre aliquote diverse per lo stesso
// prodotto: ogni decisione presa guardando questo riquadro era presa su un
// numero inventato. Ora l'aliquota serve solo per l'etichetta, e l'importo
// arriva sommato dal database.

const HEALTH_TONE: Record<string, { bg: string; fg: string }> = {
  olive:     { bg: 'bg-olive-100',     fg: 'text-olive-700' },
  primary:   { bg: 'bg-primary-100',   fg: 'text-primary-700' },
  accent:    { bg: 'bg-accent-100',    fg: 'text-accent-700' },
  secondary: { bg: 'bg-secondary-100', fg: 'text-secondary-600' },
};

/** Tile "salute del marketplace": medaglione + valore grande + label + hint. */
function HealthTile({
  icon: Icon, tone, label, value, hint,
}: { icon: LucideIcon; tone: keyof typeof HEALTH_TONE; label: string; value: string; hint?: string }) {
  const t = HEALTH_TONE[tone];
  return (
    <div className="rounded-xl border-2 border-cream-300 bg-white p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <span className={`inline-flex h-[34px] w-[34px] items-center justify-center rounded-md ${t.bg} ${t.fg}`}>
          <Icon size={17} strokeWidth={2.2} aria-hidden />
        </span>
      </div>
      <p className="text-[24px] font-extrabold leading-none text-ink-900">{value}</p>
      <p className="mt-1.5 text-xs text-ink-500">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-400">{hint}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: queryKeys.admin.stats,
    queryFn: async () => {
      // I conti si fanno nel database, non nel browser.
      //
      // Prima queste tre righe scaricavano le tabelle INTERE e sommavano qui,
      // senza limite dichiarato. PostgREST però ha un tetto di righe per
      // risposta: superato quello la risposta arriva troncata e non lo dice.
      // Appena il marketplace cresce, ogni numero di questa pagina comincia a
      // mentire per difetto — e nessuno lo nota, perché il numero c'è: sembra
      // solo più piccolo. Ora una funzione conta dove stanno i dati.
      const { data, error } = await supabase.rpc('admin_kpi');
      if (error) throw error;

      const k = (data ?? {}) as {
        utenti?: Record<string, number>;
        utenti_totali?: number;
        ordini_totali?: number;
        ordini_per_stato?: Record<string, number>;
        incassato_cents?: number;
        ordini_7g?: number;
        prodotti_totali?: number;
        prodotti_disponibili?: number;
        commissioni_cents?: number;
      };
      const ruoli = k.utenti ?? {};

      return {
        users: {
          total: k.utenti_totali ?? 0,
          buyers: ruoli.buyer ?? 0,
          sellers: ruoli.seller ?? 0,
          riders: ruoli.rider ?? 0,
          admins: ruoli.admin ?? 0,
        },
        orders: {
          total: k.ordini_totali ?? 0,
          recent: k.ordini_7g ?? 0,
          byStatus: (k.ordini_per_stato ?? {}) as Record<string, number>,
          revenue: (k.incassato_cents ?? 0) / 100,
        },
        products: {
          total: k.prodotti_totali ?? 0,
          available: k.prodotti_disponibili ?? 0,
        },
        // La commissione REALE registrata sugli ordini, non una stima su
        // un'aliquota scritta a mano nella pagina.
        commissioniReali: (k.commissioni_cents ?? 0) / 100,
      };
    },
    refetchInterval: 30_000,
  });

  /**
   * 27/8/2026 (R046) — QUANTI PAGAMENTI VANNO A BUON FINE.
   *
   * Ogni tentativo con carta finisce in `payment_attempts` col motivo del
   * rifiuto. Nessuno lo leggeva: ne' una pagina, ne' una query, ne' un avviso.
   * Un checkout rotto — una chiave scaduta, il 3D Secure che non funziona su un
   * browser — lo si sarebbe scoperto dal calo degli ordini, giorni dopo.
   *
   * La lettura e' separata da quella dei numeri grossi apposta: se questa non
   * riesce (la tabella nasce con la migrazione 124) la Panoramica si vede lo
   * stesso, con un trattino al posto della percentuale.
   */
  const { data: pagamenti } = useQuery({
    queryKey: ['admin', 'tasso-autorizzazione'],
    queryFn: async () => {
      const daQuando = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from('payment_attempts')
        .select('status, decline_code, error_code')
        .gte('created_at', daQuando)
        .limit(5000);
      if (error) throw error;
      return tassoAutorizzazione((data ?? []) as TentativoPagamento[]);
    },
    refetchInterval: 60_000,
    retry: false,
  });

  if (isLoading || !stats) {
    return <LoadingState />;
  }

  // Salute del marketplace — metriche derivate dai dati già caricati (nessuna API nuova).
  const gmv = stats.orders.revenue;
  const delivered = stats.orders.byStatus.DELIVERED ?? 0;
  const canceled = stats.orders.byStatus.CANCELED ?? 0;
  // La commissione trattenuta davvero, sommata dagli ordini. Prima era
  // `gmv * 0.14`: un'aliquota scritta a mano (14%) diversa da quella reale
  // (10%), applicata anche a spedizione e quota di consegna che non sono
  // soggette a commissione. Due errori nello stesso numero, entrambi verso
  // l'alto.
  const commissions = stats.commissioniReali;
  const aov = delivered > 0 ? gmv / delivered : 0;
  const closedOrders = stats.orders.total - (stats.orders.byStatus.NEW ?? 0) - (stats.orders.byStatus.ACCEPTED ?? 0);
  const fulfillmentRate = closedOrders > 0 ? (delivered / closedOrders) * 100 : 0;
  const cancelRate = stats.orders.total > 0 ? (canceled / stats.orders.total) * 100 : 0;
  const fulfillmentLow = fulfillmentRate > 0 && fulfillmentRate < 95;

  // Pagamenti riusciti sul totale di chi ci ha provato davvero. Chi abbandona
  // sulla schermata della banca non compare ne' fra i riusciti ne' fra i
  // rifiutati: e' scritto nel riquadro, per non far credere che questo numero
  // misuri l'abbandono del checkout.
  const tassoPagamenti = pagamenti?.tasso ?? null;
  const pagamentiDaGuardare = pagamenti ? tassoDaGuardare(pagamenti) : false;
  const motivoPrincipale = pagamenti?.motivi[0];

  return (
    <div className="space-y-8">
      <AdminPageTitle
        eyebrow="Marketplace"
        title="Panoramica"
        sub="Tutti i numeri del marketplace, in tempo reale."
      />

      {/* Salute del marketplace */}
      <section>
        <AdminSectionLabel icon={Activity}>Salute del marketplace</AdminSectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
          <HealthTile icon={Euro} tone="olive" label="GMV (ordini consegnati)" value={formatPrice(gmv)} hint={`AOV ${formatPrice(aov)}`} />
          <HealthTile icon={Percent} tone="primary" label={`Commissioni (${MARKETPLACE_FEE_BPS / 100}% del subtotale)`} value={formatPrice(commissions)} hint="trattenuta reale sugli ordini consegnati" />
          <HealthTile icon={Timer} tone="accent" label="Tasso di consegna" value={`${fulfillmentRate.toFixed(1)}%`} hint="obiettivo ≥ 95%" />
          <HealthTile icon={Store} tone="secondary" label="Tasso di annullamento" value={`${cancelRate.toFixed(1)}%`} hint={`${canceled} ordini annullati`} />
          <HealthTile
            icon={CreditCard}
            tone={pagamentiDaGuardare ? 'accent' : 'primary'}
            label="Pagamenti riusciti (30 giorni)"
            value={tassoPagamenti === null ? '—' : `${(tassoPagamenti * 100).toFixed(1)}%`}
            hint={
              pagamenti && pagamenti.tentativi > 0
                ? `${pagamenti.riusciti} su ${pagamenti.tentativi} tentativi con carta${motivoPrincipale ? ` · piu frequente: ${motivoPrincipale.codice}` : ''}`
                : 'nessun tentativo con carta registrato'
            }
          />
        </div>
        {pagamentiDaGuardare && (
          <div className="mt-2.5 flex items-center gap-2 rounded-md border border-accent-200 bg-accent-50 px-3.5 py-2.5 text-[13px] text-accent-900">
            <Info size={15} className="shrink-0 text-accent-700" aria-hidden />
            <span>
              Piu di un pagamento su dieci viene rifiutato
              {motivoPrincipale ? <> (motivo piu frequente: <strong>{motivoPrincipale.codice}</strong>)</> : null}.
              Chi si ferma sulla schermata della banca non e contato qui: questo e il conto di chi ha provato davvero a pagare.
            </span>
          </div>
        )}
        {fulfillmentLow && (
          <div className="mt-2.5 flex items-center gap-2 rounded-md border border-accent-200 bg-accent-50 px-3.5 py-2.5 text-[13px] text-accent-900">
            <Info size={15} className="shrink-0 text-accent-700" aria-hidden />
            <span>
              Il tasso di consegna è sotto l&apos;obiettivo:{' '}
              <strong>verifica gli ordini bloccati</strong> in{' '}
              <Link href="/admin/orders" className="font-semibold underline">Ordini</Link>.
            </span>
          </div>
        )}
      </section>

      {/* Scorciatoie: solo mobile (su desktop la navigazione è nella sidebar cockpit). */}
      <section className="md:hidden">
        <AdminSectionLabel icon={LayoutGrid}>Sezioni</AdminSectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {getAccountMenuItems('admin')
            .filter((it) => it.href.startsWith('/admin') && it.href !== '/admin')
            .map((it) => {
              const Icon = it.icon;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className="flex items-center gap-2 bg-white border border-cream-300 rounded-lg px-3 py-2.5 text-sm font-semibold text-ink-700 hover:border-primary-300 hover:bg-cream-50 transition-colors"
                >
                  <Icon size={16} strokeWidth={2.2} className="text-primary-700 shrink-0" aria-hidden />
                  <span className="truncate">{it.label}</span>
                </Link>
              );
            })}
        </div>
      </section>

      <section>
        <AdminSectionLabel icon={Users}>Utenti · {stats.users.total}</AdminSectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <AdminStatCard tone="primary"   icon={ShoppingCart} label="Acquirenti" value={stats.users.buyers}  href="/admin/users?role=buyer" />
          <AdminStatCard tone="accent"    icon={Store}        label="Venditori"  value={stats.users.sellers} href="/admin/users?role=seller" />
          <AdminStatCard tone="olive"     icon={Bike}         label="Rider"      value={stats.users.riders}  href="/admin/users?role=rider" />
          <AdminStatCard tone="secondary" icon={Shield}       label="Admin"      value={stats.users.admins}  href="/admin/users?role=admin" />
        </div>
      </section>

      <section>
        <AdminSectionLabel icon={Package}>Ordini · {stats.orders.total}</AdminSectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <AdminStatCard tone="primary" icon={Package}      label="Totali"          value={stats.orders.total} href="/admin/orders" />
          <AdminStatCard tone="accent"  icon={TrendingUp}   label="Ultimi 7 giorni" value={stats.orders.recent} href="/admin/orders" />
          <AdminStatCard tone="olive"   icon={CheckCircle2} label="Consegnati"      value={stats.orders.byStatus.DELIVERED ?? 0} />
          <AdminStatCard tone="olive"   icon={Banknote}     label="Ricavi totali"   value={formatPrice(stats.orders.revenue)} />
        </div>

        <div className="bg-white border-2 border-cream-300 rounded-xl p-5 mt-4">
          <h3 className="font-serif text-[17px] font-bold text-ink-900 mb-3.5">Stato degli ordini</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            {(['NEW','ACCEPTED','READY','ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED','CANCELED'] as OrderStatus[]).map((s) => {
              const Icon = ORDER_STATUS_ICON[s];
              return (
              <div key={s} className="flex items-center justify-between bg-cream-50 rounded-md px-3 py-2">
                <span className="text-ink-600 truncate inline-flex items-center gap-1.5">
                  <Icon size={14} strokeWidth={2.2} aria-hidden />
                  {ORDER_STATUS_LABEL[s]}
                </span>
                <span className="font-extrabold text-ink-900">{stats.orders.byStatus[s] ?? 0}</span>
              </div>
              );
            })}
          </div>
        </div>
      </section>

      <section>
        <AdminSectionLabel icon={ShoppingBag}>Catalogo</AdminSectionLabel>
        <div className="grid grid-cols-2 gap-3.5">
          <AdminStatCard tone="primary" icon={Package}      label="Prodotti totali"    value={stats.products.total} href="/admin/products" />
          <AdminStatCard tone="olive"   icon={CheckCircle2} label="Disponibili online" value={stats.products.available} />
        </div>
      </section>
    </div>
  );
}

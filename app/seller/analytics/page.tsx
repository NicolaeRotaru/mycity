'use client';

import { useEffect, useState } from 'react';
import { metricheVenditore, ordineContaNelFatturato } from '@/lib/metriche-venditore';
import { giornoPiacenza, oraPiacenza, ultimiGiorniPiacenza } from '@/lib/tempo-piacenza';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Eye, ShoppingCart, Star, Sparkles, Lightbulb, PackageX, type LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { useRouter } from 'next/navigation';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { vistaDaQuery } from '@/lib/vista-query';
import { Card } from '@/components/ui/Card';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import { queryKeys } from '@/lib/queries/keys';
import { numeriDellAndamento, type RigaAndamento } from '@/lib/seller/andamento-negozio';
import { letturaDellAndamento, tassoDiConversione, numeroOTrattino } from './letture-dell-andamento';

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

  const queryAnalytics = useQuery({
    queryKey: queryKeys.seller.analytics(userId ?? ''),
    enabled: !!userId,
    queryFn: async () => {
      const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const since7 = new Date(Date.now() - 7 * 86400000).toISOString();

      // Prodotti del seller
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('id, name, price, images, status, stock, created_at')
        .eq('seller_id', userId!);
      // Tutta la pagina Andamento si regge su questo elenco: senza il controllo, una lettura
      // fallita diventa «zero prodotti», e da lì zero viste, zero ordini, zero fatturato — numeri
      // che sembrano una brutta settimana e sono un guasto di rete.
      if (productsError) throw productsError;

      const productIds = (products ?? []).map((p) => p.id);
      const empty = {
        // Senza prodotti a catalogo questi zeri sono veri, non un ripiego.
        visiteIgnote: false,
        views30: 0 as number | null, views7: 0 as number | null, viewsToday: 0 as number | null,
        orders30: 0, orders7: 0, ordiniRicevuti30: 0,
        revenue30: 0, revenue7: 0,
        conversionRate: null as number | null,
        avgRating: 0 as number | null, reviewCount: 0 as number | null,
        topProducts: [] as Array<{ id: string; name?: string; price?: number; views: number }>,
        slowProducts: [] as Array<{ id: string; name?: string; views: number }>,
        revenueSeries: [] as Array<{ label: string; value: number }>,
        peakHours: [] as Array<{ label: string; value: number; pct: number }>,
        peakLabel: null as string | null,
      };
      if (productIds.length === 0) return empty;

      /**
       * 27/8/2026 (R071) — QUESTA PAGINA SCARICAVA VENTIMILA RIGHE PER MOSTRARE
       * TRE NUMERI.
       *
       * Le visite ai prodotti degli ultimi trenta giorni venivano portate tutte
       * nel browser, mille righe per volta, in venti richieste una dietro
       * l'altra, e poi contate in JavaScript. Un negozio con ventimila visite in
       * un mese — cioè un negozio che sta andando bene — apriva «Andamento» e il
       * telefono ci metteva decine di secondi e megabyte di traffico. Oltre le
       * ventimila il conteggio si fermava e sbagliava per difetto.
       *
       * Nella stessa lettura le recensioni venivano lette senza limite: quelle
       * si fermavano a mille in silenzio.
       *
       * Adesso conta il database e torna una riga: i tre totali, le visite per
       * prodotto e il voto medio del negozio. L'indice giusto c'era già.
       */
      const [andamentoRes, ordersRes] = await Promise.all([
        supabase.rpc('andamento_del_negozio'),
        supabase
          .from('orders')
          // 3/9/2026 — senza `refunded_amount_cents` la definizione unica del
          // fatturato non puo' togliere i rimborsi: la pagina Andamento
          // mostrava l'ordine rimborsato per intero.
          .select('id, total_price, delivery_status, payment_status, application_fee_cents, shipping_cost, delivery_fee_cents, refunded_amount_cents, created_at')
          .eq('seller_id', userId!)
          .gte('created_at', since30),
      ]);

      // #217 — Prima l'errore veniva buttato: se una delle letture falliva,
      // la pagina mostrava zero e sembrava una giornata storta. Uno zero che
      // vuol dire «non lo so» e' peggio di un errore, perche' il negoziante ci
      // crede. Ora l'errore risale e react-query mostra lo stato di errore.
      //
      // 3/9/2026 — Ma le due letture non hanno lo stesso peso, e prima venivano
      // buttate insieme. In produzione `andamento_del_negozio` non c'e' ancora
      // (migrazione 141 non applicata): mancavano le visite, e il negoziante
      // trovava una schermata di guasto al posto del SUO FATTURATO, che era
      // stato letto benissimo. Senza gli ordini la pagina si ferma; senza le
      // visite continua, e quello che non sa lo dice.
      const esito = letturaDellAndamento(ordersRes.error, andamentoRes.error);
      if (esito.fermati) throw esito.errore;
      const visiteIgnote = esito.visiteIgnote;

      const riga = (Array.isArray(andamentoRes.data) ? andamentoRes.data[0] : andamentoRes.data) as RigaAndamento | null;
      const orders = (ordersRes.data ?? []) as Array<{ id: string; total_price: number; delivery_status: string; created_at: string }>;

      // «Oggi» e' oggi a Piacenza, non a Greenwich (#221): il taglio del giorno
      // lo fa la funzione del database, con lo stesso fuso.
      const numeri = numeriDellAndamento(riga);
      // Quando le visite non si sono potute leggere, qui non c'e' uno zero: c'e'
      // un buco dichiarato. Zero visite e «non lo so» si disegnano diversi.
      const views30 = visiteIgnote ? null : numeri.views30;
      const views7 = visiteIgnote ? null : numeri.views7;
      const viewsToday = visiteIgnote ? null : numeri.viewsToday;
      const avgRating = visiteIgnote ? null : numeri.avgRating;
      const reviewCount = visiteIgnote ? null : numeri.reviewCount;
      const viewsByProduct = visiteIgnote ? {} : numeri.viewsByProduct;

      /**
       * 22/8/2026 — «I TUOI ORDINI» CONTAVA ANCHE QUELLI ANNULLATI E MAI PAGATI.
       *
       * Qui si contavano tutte le righe. Dentro ci sono gli ordini che il
       * negozio ha rifiutato, quelli che il cliente ha annullato e quelli in
       * cui il pagamento non e' mai riuscito: cose che al negozio non hanno
       * portato un euro. Due righe piu' sotto l'incasso li escludeva
       * (`metricheVenditore` applica la regola giusta), quindi la stessa
       * schermata mostrava «40 ordini» e un incasso da 31: il negoziante
       * calcolava uno scontrino medio piu' basso del vero e si convinceva di
       * vendere male.
       *
       * `ordineContaNelFatturato` e' la definizione unica, la stessa che usa
       * l'incasso: non annullato E pagato.
       */
      const ordiniValidi = (orders as never[]).filter(ordineContaNelFatturato);
      const orders30 = ordiniValidi.length;
      const orders7 = ordiniValidi.filter((o: { created_at: string }) => o.created_at >= since7).length;
      /** Quanti ne sono arrivati in tutto, validi o no: e' un altro numero. */
      const ordiniRicevuti30 = orders.length;
      // Una definizione sola, da lib/metriche-venditore: qui il numero mostrato
      // e' quello che resta AL NEGOZIO, senza spedizione, quota di consegna e
      // commissione. Prima era il totale degli ordini consegnati — soldi che in
      // parte non sono suoi — e le altre due pagine ne davano altri due valori.
      const revenue30 = metricheVenditore(orders as never[]).tuoNettoCents / 100;
      const revenue7 = metricheVenditore(orders as never[], new Date(since7)).tuoNettoCents / 100;

      /**
       * 22/8/2026 — IL TASSO DI CONVERSIONE DIVIDEVA MELE PER PERE.
       *
       * Sopra: gli ordini di TUTTI. Sotto: le visite dei soli visitatori che
       * hanno accettato i cookie — perche' `product_views` si riempie solo con
       * il consenso. Due popolazioni diverse una sopra l'altra: piu' persone
       * rifiutano i cookie, piu' il tasso sembra alto. Un negozio con metà dei
       * visitatori che dicono no vede un tasso doppio del vero, e su quel
       * numero decide se abbassare i prezzi.
       *
       * Il numeratore adesso e' almeno la popolazione giusta (ordini validi), e
       * accanto al numero si dichiara quanto vale il campione: finche' le
       * visite dipendono dal consenso, quel tasso e' un indizio, non una
       * misura. Portare le visite a un conteggio aggregato senza identita' — che
       * il consenso non lo richiede — e' il lavoro che chiude davvero il
       * difetto, ed e' scritto nel referto.
       */
      const conversionRate = tassoDiConversione(orders30, views30);

      // Top products by views
      const productMap = new Map((products ?? []).map((p) => [p.id, p]));
      const topProducts = Object.entries(viewsByProduct)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, count]) => ({ ...productMap.get(id), views: count }))
        .filter((p) => p.id) as Array<{ id: string; name?: string; price?: number; views: number }>;

      // Slow products (publicati ma pochi/zero view).
      //
      // Senza le visite questo elenco non si fa: ogni prodotto avrebbe «0
      // visite», e la pagina direbbe al negoziante che i suoi tre prodotti
      // migliori non li guarda nessuno — consigliandogli di scontarli.
      const slowProducts = visiteIgnote ? [] : (products ?? [])
        .filter((p) => p.status === 'available')
        .map((p) => ({ ...p, views: viewsByProduct[p.id] ?? 0 }))
        .sort((a, b) => a.views - b.views)
        .slice(0, 3) as Array<{ id: string; name?: string; views: number }>;

      // Serie ricavi ultimi 7 giorni.
      //
      // #218 — Il grafico usava una terza definizione di fatturato, dentro la
      // stessa pagina che ne mostrava gia' un'altra nelle schede: prendeva il
      // totale pieno dei soli ordini CONSEGNATI, spedizione e quota di consegna
      // comprese, cioe' soldi che al negozio non arrivano. La somma delle barre
      // non tornava mai col numero sopra. Ora barre e schede usano la stessa
      // definizione: il netto del negozio sugli ordini pagati e non annullati.
      //
      // #221 — E le giornate sono quelle di Piacenza.
      const giorni = ultimiGiorniPiacenza(7);
      const dayBuckets = giorni.map((key) => ({
        key,
        label: DAY_LABELS[new Date(`${key}T12:00:00Z`).getUTCDay()],
        value: 0,
      }));
      const dayIndex = new Map(dayBuckets.map((b, i) => [b.key, i]));
      for (const o of orders) {
        if (!ordineContaNelFatturato(o as never)) continue;
        const i = dayIndex.get(giornoPiacenza(o.created_at));
        if (i != null) dayBuckets[i].value += metricheVenditore([o as never]).tuoNettoCents / 100;
      }
      const revenueSeries = dayBuckets.map((b) => ({ label: b.label, value: b.value }));

      // Ore di punta: distribuzione oraria reale degli ordini (30gg).
      const hourCounts = new Array(24).fill(0) as number[];
      // #221 — L'ora di punta e' l'ora del negozio, non quella del browser di
      // chi guarda: chi apre la pagina da un fuso diverso vedeva altre fasce.
      for (const o of orders) hourCounts[oraPiacenza(o.created_at)] += 1;
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

      return { visiteIgnote, views30, views7, viewsToday, orders30, orders7, ordiniRicevuti30, revenue30, revenue7, conversionRate, avgRating, reviewCount, topProducts, slowProducts, revenueSeries, peakHours, peakLabel };
    },
  });

  // Qui c'era `if (!userId || isLoading) return <LoadingState />;` e alla riga dopo
  // `analytics.topProducts[0]`. Con la lettura fallita `analytics` è undefined, quindi la pagina
  // si schiantava e il confine d'errore dell'area raccoglieva il pezzo. Il risultato a schermo era
  // quello giusto, ma per caso: bastava una riga difensiva aggiunta per fare pulizia e questa
  // pagina avrebbe cominciato a mostrare zeri come i Guadagni — peggiorando in silenzio proprio
  // mentre sembrava che la si stesse sistemando. Adesso l'errore si mostra perché è deciso.
  const vista = vistaDaQuery(queryAnalytics);
  if (!userId || vista.mostraScheletro) return <LoadingState />;
  if (vista.mostraErrore) {
    return (
      <ErrorState
        title="Non sono riuscito a leggere l'andamento del negozio"
        description="La lettura non è riuscita, quindi non so come sta andando. Non vuol dire che sia andato male: riprova fra un momento."
        onRetry={() => queryAnalytics.refetch()}
      />
    );
  }
  const analytics = vista.dati!;
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
        <KpiCard
          icon={TrendingUp}
          label="Conversion rate"
          value={`${analytics.conversionRate.toFixed(1)}%`}
          // Il campione, dichiarato: le visite si contano solo su chi accetta i
          // cookie, quindi questo numero e' un indizio, non una misura.
          delta={`su ${analytics.views30} visite misurate`}
          color={analytics.conversionRate >= 2 ? 'olive' : analytics.conversionRate >= 1 ? 'accent' : 'secondary'}
        />
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

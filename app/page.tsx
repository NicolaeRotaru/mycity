import Link from 'next/link';
import { Store, Check, ShieldCheck, MapPin, ArrowRight, Heart, Sparkles, Gift, Coffee, Banknote, Home as HomeIcon, Truck, RotateCcw } from 'lucide-react';
import ProductGrid from '@/components/ProductGrid';
import CategoryShowcase from '@/components/CategoryShowcase';
import StoreShowcase from '@/components/StoreShowcase';
import LiveActivityFeed from '@/components/LiveActivityFeed';
import HomeRedirectGuard from '@/components/HomeRedirectGuard';
import NewsletterForm from '@/components/NewsletterForm';
import DropOfDay from '@/components/home/DropOfDay';
import StoryOfDay from '@/components/home/StoryOfDay';
import TrendingNow from '@/components/home/TrendingNow';

/**
 * Homepage MyCity — "Mediterranean Modern" + edit del giorno.
 *
 * Architettura del feed (top → bottom):
 *  1. Hero: claim + CTA + card prodotto fake "premium"
 *  2. Drop del giorno (urgenza + countdown)
 *  3. Storia di oggi (content + brand locale)
 *  4. Trending now (FOMO + social proof)
 *  5. Categorie (discoverability)
 *  6. Live activity (FOMO continuo)
 *  7. Negozi vicini (proximity)
 *  8. Trust band (riassurance)
 *  9. Newsletter incentive
 * 10. CTA venditore (acquisizione supply)
 */
export default function Home() {
  return (
    <div className="bg-cream-100">
      <HomeRedirectGuard />

      {/* HERO — cream background, terracotta accents, serif headline */}
      <section className="relative overflow-hidden bg-gradient-to-b from-cream-50 to-cream-100">
        {/* Decorazione discreta */}
        <div aria-hidden className="absolute -top-20 -right-20 w-[500px] h-[500px] rounded-full bg-primary-200/40 blur-3xl" />
        <div aria-hidden className="absolute -bottom-32 -left-20 w-[420px] h-[420px] rounded-full bg-accent-200/40 blur-3xl" />

        <div className="container mx-auto px-4 sm:px-6 py-12 md:py-20 relative">
          <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-10 items-center">
            <div className="space-y-6">
              <span className="inline-flex items-center gap-1.5 bg-primary-100 text-primary-800 px-3 py-1 rounded-full text-xs font-semibold tracking-wide ring-1 ring-primary-200">
                <Sparkles size={14} strokeWidth={2.4} />
                Il marketplace della tua città
              </span>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif font-bold leading-[1.05] tracking-tight text-ink-900">
                Compra dai negozi<br />
                <span className="text-primary-700 italic">veri</span> di Piacenza.
              </h1>
              <p className="text-lg text-ink-600 max-w-xl leading-relaxed">
                Alimentari, abbigliamento, casa, elettronica: tutto dai commercianti
                della tua via. <strong className="text-ink-900">Paghi alla consegna</strong>,
                ricevi a casa in 24-48h.
              </p>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/search"
                  className="inline-flex items-center gap-2 bg-primary-700 hover:bg-primary-800 text-white px-6 py-3 rounded-full font-semibold transition-colors shadow-warm"
                >
                  Inizia a esplorare
                  <ArrowRight size={18} strokeWidth={2.2} />
                </Link>
                <Link
                  href="/stores"
                  className="inline-flex items-center gap-2 bg-white hover:bg-cream-50 text-ink-900 border border-cream-300 px-6 py-3 rounded-full font-semibold transition-colors"
                >
                  <Store size={18} strokeWidth={2.2} />
                  Esplora i negozi
                </Link>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 text-sm text-ink-600">
                <span className="inline-flex items-center gap-1.5">
                  <Check size={16} strokeWidth={2.4} className="text-olive-600" />
                  Spedizione gratis sopra €30
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check size={16} strokeWidth={2.4} className="text-olive-600" />
                  Reso entro 14 giorni
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check size={16} strokeWidth={2.4} className="text-olive-600" />
                  Pagamento alla consegna
                </span>
              </div>
            </div>

            {/* Card di destra "Anteprima negozio" — carosello prodotti scrollabile */}
            <div className="hidden md:flex justify-center">
              <div className="relative w-full max-w-sm">
                <div className="bg-white border border-cream-300 rounded-2xl shadow-warm-lg p-6 space-y-4 overflow-hidden">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center">
                      <Coffee size={22} strokeWidth={2} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-900 truncate">Salumeria del Borgo</p>
                      <p className="text-xs text-ink-500 flex items-center gap-1">
                        <MapPin size={12} strokeWidth={2} /> Via Calzolai 12 · 0.4 km
                      </p>
                    </div>
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold bg-olive-50 text-olive-700 px-2 py-0.5 rounded-full ring-1 ring-olive-200 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-olive-600 animate-pulse-soft" />
                      Aperto
                    </span>
                  </div>

                  {/* Carosello orizzontale: 10 prodotti, almeno 3 scroll */}
                  <div className="relative -mx-6 px-6">
                    <div className="flex gap-2 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-1">
                      {[
                        { name: 'Coppa DOP',        price: '€9,50',  grad: 'from-accent-100 to-primary-100' },
                        { name: 'Pancetta',         price: '€7,80',  grad: 'from-primary-100 to-secondary-100' },
                        { name: 'Salame',           price: '€12,00', grad: 'from-secondary-100 to-accent-100' },
                        { name: 'Prosciutto crudo', price: '€15,00', grad: 'from-accent-100 to-cream-300' },
                        { name: 'Mortadella',       price: '€6,40',  grad: 'from-cream-300 to-primary-100' },
                        { name: 'Bresaola',         price: '€18,00', grad: 'from-primary-100 to-accent-200' },
                        { name: 'Speck IGP',        price: '€14,50', grad: 'from-accent-200 to-secondary-100' },
                        { name: 'Lonzino',          price: '€10,90', grad: 'from-secondary-100 to-primary-200' },
                        { name: 'Culatello',        price: '€24,00', grad: 'from-primary-200 to-cream-300' },
                        { name: 'Pancetta arr.',    price: '€9,20',  grad: 'from-cream-300 to-accent-200' },
                      ].map((p) => (
                        <div key={p.name} className="bg-cream-100 rounded-lg p-2 shrink-0 w-24 snap-start">
                          <div className={`aspect-square rounded bg-gradient-to-br ${p.grad} mb-1.5`} />
                          <p className="text-[10px] text-ink-600 truncate">{p.name}</p>
                          <p className="text-xs font-semibold text-ink-900">{p.price}</p>
                        </div>
                      ))}
                      {/* Spacer finale per evitare che l'ultimo sia tagliato dal fade */}
                      <div aria-hidden className="shrink-0 w-2" />
                    </div>
                    {/* Fade ai bordi che suggerisce lo scroll */}
                    <div aria-hidden className="pointer-events-none absolute left-0 top-0 bottom-1 w-6 bg-gradient-to-r from-white to-transparent" />
                    <div aria-hidden className="pointer-events-none absolute right-0 top-0 bottom-1 w-6 bg-gradient-to-l from-white to-transparent" />
                  </div>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-cream-200">
                    <span className="text-ink-500">Consegna stimata</span>
                    <span className="font-semibold text-ink-900">oggi, entro 18:00</span>
                  </div>
                </div>
                <div className="absolute -top-4 -right-4 bg-accent-500 text-ink-900 px-3 py-1.5 rounded-full font-bold text-xs shadow-warm-lg ring-2 ring-white">
                  100% locale
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* DROP DEL GIORNO */}
      <section className="container mx-auto px-4 sm:px-6 py-10">
        <DropOfDay />
      </section>

      {/* STORIA DI OGGI */}
      <section className="container mx-auto px-4 sm:px-6 py-10">
        <StoryOfDay />
      </section>

      {/* TRENDING NOW */}
      <section className="container mx-auto px-4 sm:px-6 py-10">
        <TrendingNow />
      </section>

      {/* CATEGORIE */}
      <section className="container mx-auto px-4 sm:px-6 py-12">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900">Cosa cerchi oggi?</h2>
          <p className="text-ink-500 text-sm mt-2">Tutte le categorie del mercato locale</p>
        </div>
        <CategoryShowcase />
      </section>

      {/* LIVE ACTIVITY + Trust band */}
      <section className="container mx-auto px-4 sm:px-6 py-10 grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
        <LiveActivityFeed />
        <div className="bg-white border border-cream-300 rounded-2xl p-6 shadow-warm">
          <h3 className="font-serif font-bold text-ink-900 text-lg mb-4">Perché scegliere MyCity</h3>
          <ul className="space-y-3">
            {[
              { Icon: Banknote, color: 'olive',     t: 'Paghi alla consegna',     d: 'Niente carta, niente registrazione obbligatoria.' },
              { Icon: HomeIcon, color: 'primary',   t: '100% commercianti locali', d: 'Solo negozi verificati di Piacenza.' },
              { Icon: Truck,    color: 'accent',    t: 'Consegna in 24-48h',       d: 'Rider del territorio, percorsi brevi.' },
              { Icon: RotateCcw,color: 'secondary', t: 'Reso entro 14 giorni',    d: 'Cambi idea? Ti rimborsiamo senza domande.' },
            ].map((v) => (
              <li key={v.t} className="flex items-start gap-3">
                <span className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                  v.color === 'olive'     ? 'bg-olive-100 text-olive-700' :
                  v.color === 'primary'   ? 'bg-primary-100 text-primary-700' :
                  v.color === 'accent'    ? 'bg-accent-100 text-accent-700' :
                                            'bg-secondary-100 text-secondary-700'
                }`}>
                  <v.Icon size={20} strokeWidth={2.2} />
                </span>
                <div>
                  <p className="font-semibold text-ink-900">{v.t}</p>
                  <p className="text-sm text-ink-600">{v.d}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* PRODOTTI POPOLARI (catalogo grosso) */}
      <section className="bg-white border-y border-cream-300 py-12">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-end mb-6 gap-4 flex-wrap">
            <div>
              <span className="inline-flex items-center gap-1.5 text-primary-700 text-xs font-bold uppercase tracking-wider">
                <Heart size={14} strokeWidth={2.4} />
                I più amati
              </span>
              <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mt-1">
                Prodotti che vanno forte
              </h2>
            </div>
            <Link href="/search" className="inline-flex items-center gap-1 text-primary-700 hover:text-primary-800 font-semibold text-sm">
              Vedi tutto <ArrowRight size={16} strokeWidth={2.4} />
            </Link>
          </div>
          <ProductGrid limit={8} />
        </div>
      </section>

      {/* NEGOZI VICINI */}
      <section className="container mx-auto px-4 sm:px-6 py-12">
        <div className="flex justify-between items-end mb-6 gap-4 flex-wrap">
          <div>
            <span className="inline-flex items-center gap-1.5 text-primary-700 text-xs font-bold uppercase tracking-wider">
              <MapPin size={14} strokeWidth={2.4} />
              Vicino a te
            </span>
            <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mt-1">
              I negozi del tuo quartiere
            </h2>
            <p className="text-ink-500 text-sm mt-1">Sostieni chi vende davvero qui</p>
          </div>
          <Link href="/stores" className="inline-flex items-center gap-1 text-primary-700 hover:text-primary-800 font-semibold text-sm">
            Tutti i negozi <ArrowRight size={16} strokeWidth={2.4} />
          </Link>
        </div>
        <StoreShowcase />
      </section>

      {/* NEWSLETTER + REFERRAL */}
      <section className="bg-gradient-to-br from-accent-100 via-accent-50 to-cream-100 border-y border-cream-300">
        <div className="container mx-auto px-4 sm:px-6 py-12 md:py-16 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 bg-white/80 text-primary-800 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ring-1 ring-primary-200">
              <Gift size={14} strokeWidth={2.4} />
              €5 in regalo
            </span>
            <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mt-3 mb-3">
              Iscriviti e prendi <span className="text-primary-700">€5 di sconto</span><br />
              al primo ordine.
            </h2>
            <p className="text-ink-700 text-base">
              Ogni venerdì ricevi <strong>"Cosa c'è nel piatto a Piacenza"</strong>:
              una ricetta, la storia di un negoziante, 3 offerte selezionate. Niente spam.
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-warm-lg p-6 border border-cream-300">
            <NewsletterForm variant="light" />
          </div>
        </div>
      </section>

      {/* CTA VENDITORE */}
      <section className="bg-ink-900 text-white">
        <div className="container mx-auto px-4 sm:px-6 py-16 md:py-20 grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          <div className="space-y-5">
            <span className="inline-flex items-center gap-1.5 bg-white/10 text-white px-3 py-1 rounded-full text-xs font-semibold tracking-wide ring-1 ring-white/15">
              <ShieldCheck size={14} strokeWidth={2.4} />
              Per i venditori
            </span>
            <h2 className="text-3xl md:text-4xl font-serif font-bold leading-tight tracking-tight">
              Hai un'attività?<br />
              <span className="text-accent-400">Portala online</span> con MyCity.
            </h2>
            <p className="text-ink-300 text-base md:text-lg leading-relaxed">
              Vetrina dedicata, prodotti illimitati, <strong className="text-white">zero commissioni</strong> sulle vendite.
              Abbonamento mensile fisso, approvazione del team in 48 ore.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href="/sell"
                className="inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-400 text-ink-900 px-6 py-3 rounded-full font-bold transition-colors shadow-lg"
              >
                <Store size={18} strokeWidth={2.4} />
                Diventa venditore
              </Link>
              <Link
                href="/stores"
                className="inline-flex items-center gap-2 bg-transparent hover:bg-white/10 text-white border border-white/30 px-6 py-3 rounded-full font-semibold transition-colors"
              >
                Vedi chi vende già
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { n: '€50/mese', l: 'Abbonamento fisso, zero commissioni sul venduto' },
              { n: '48h',      l: "Per l'approvazione del negozio" },
              { n: '∞',        l: 'Prodotti pubblicabili' },
              { n: 'IBAN',     l: 'Bonifico mensile dei tuoi incassi' },
            ].map((s) => (
              <div key={s.l} className="bg-white/5 ring-1 ring-white/10 rounded-xl p-5">
                <div className="text-2xl md:text-3xl font-serif font-bold mb-2 text-accent-400">{s.n}</div>
                <div className="text-xs text-ink-300 leading-snug">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

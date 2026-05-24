import Link from 'next/link';
import { ShoppingBag, Store, Check, ShieldCheck, MapPin, Sparkles, ArrowRight, Flame } from 'lucide-react';
import ProductGrid from '@/components/ProductGrid';
import CategoryShowcase from '@/components/CategoryShowcase';
import StoreShowcase from '@/components/StoreShowcase';
import ValueProps from '@/components/ValueProps';
import LiveActivityFeed from '@/components/LiveActivityFeed';
import HomeRedirectGuard from '@/components/HomeRedirectGuard';

export default function Home() {
  return (
    <div>
      <HomeRedirectGuard />

      {/* HERO — sobrio, brand subtle nello sfondo, copy chiaro */}
      <section className="relative overflow-hidden bg-white">
        {/* Decorazione: gradient blob discreto in sfondo, non protagonista */}
        <div
          aria-hidden
          className="absolute -top-32 -right-32 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100 blur-3xl opacity-70"
        />
        <div
          aria-hidden
          className="absolute -bottom-40 -left-20 w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-amber-50 to-indigo-50 blur-3xl opacity-60"
        />

        <div className="container mx-auto px-6 py-16 md:py-24 relative">
          <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-12 items-center">
            <div className="space-y-7">
              <span className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-semibold tracking-wide ring-1 ring-indigo-100">
                <Sparkles size={14} strokeWidth={2.4} />
                Il mercato della tua città, online
              </span>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight tracking-tight text-gray-900">
                Compra dai negozi<br />
                <span className="text-indigo-600">della tua città</span>
              </h1>
              <p className="text-lg text-gray-600 max-w-xl leading-relaxed">
                Alimentari, abbigliamento, casa, elettronica: tutto dai commercianti
                locali. <strong className="text-gray-900">Paghi alla consegna</strong>,
                ricevi a casa in 24-48h.
              </p>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/search"
                  className="inline-flex items-center gap-2 bg-gray-900 hover:bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                >
                  <ShoppingBag size={18} strokeWidth={2.2} />
                  Inizia ad acquistare
                </Link>
                <Link
                  href="/stores"
                  className="inline-flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-900 border border-gray-300 px-6 py-3 rounded-lg font-semibold transition-colors"
                >
                  <Store size={18} strokeWidth={2.2} />
                  Esplora i negozi
                </Link>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 text-sm text-gray-600">
                <span className="inline-flex items-center gap-1.5">
                  <Check size={16} strokeWidth={2.4} className="text-emerald-600" />
                  Spedizione gratuita sopra €30
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check size={16} strokeWidth={2.4} className="text-emerald-600" />
                  Reso entro 14 giorni
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check size={16} strokeWidth={2.4} className="text-emerald-600" />
                  Nessun account obbligatorio per pagare
                </span>
              </div>
            </div>

            {/* Card di destra: anteprima "marketplace" pulita, non un'emoji */}
            <div className="hidden md:flex justify-center">
              <div className="relative w-full max-w-sm">
                <div className="bg-white border border-gray-200 rounded-2xl shadow-xl p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
                      <Store size={22} strokeWidth={2} />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">Salumeria del Borgo</p>
                      <p className="text-xs text-gray-500 flex items-center gap-1">
                        <MapPin size={12} strokeWidth={2} /> Via Calzolai 12 · 0.4 km
                      </p>
                    </div>
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full ring-1 ring-emerald-100">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Aperto
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { name: 'Coppa DOP', price: '€9,50' },
                      { name: 'Pancetta',  price: '€7,80' },
                      { name: 'Salame',    price: '€12,00' },
                    ].map((p) => (
                      <div key={p.name} className="bg-gray-50 rounded-lg p-2">
                        <div className="aspect-square rounded bg-gradient-to-br from-amber-100 to-rose-100 mb-1.5" />
                        <p className="text-[10px] text-gray-600 truncate">{p.name}</p>
                        <p className="text-xs font-semibold text-gray-900">{p.price}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-100">
                    <span className="text-gray-500">Consegna stimata</span>
                    <span className="font-semibold text-gray-900">oggi, entro 18:00</span>
                  </div>
                </div>
                <div className="absolute -top-4 -right-4 bg-amber-400 text-gray-900 px-3 py-1.5 rounded-full font-semibold text-xs shadow-lg ring-2 ring-white">
                  100% locale
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <ValueProps />

      {/* CATEGORIE */}
      <section className="container mx-auto px-6 py-12 md:py-16">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900">Cosa cerchi oggi?</h2>
          <p className="text-gray-500 text-sm mt-2">Tutte le categorie del mercato locale</p>
        </div>
        <CategoryShowcase />
      </section>

      {/* PRODOTTI IN EVIDENZA */}
      <section className="bg-gray-50 border-y border-gray-100 py-12 md:py-16">
        <div className="container mx-auto px-6">
          <div className="flex justify-between items-end mb-8 gap-4 flex-wrap">
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-700">
                <Flame size={14} strokeWidth={2.4} />
                In evidenza
              </span>
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mt-1">I prodotti più amati</h2>
            </div>
            <Link href="/search" className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-semibold text-sm">
              Vedi tutto <ArrowRight size={16} strokeWidth={2.2} />
            </Link>
          </div>
          <ProductGrid limit={8} />
        </div>
      </section>

      {/* NEGOZI */}
      <section className="container mx-auto px-6 py-12 md:py-16">
        <div className="flex justify-between items-end mb-8 gap-4 flex-wrap">
          <div>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-700">
              <MapPin size={14} strokeWidth={2.4} />
              Vicino a te
            </span>
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mt-1">Negozi della tua città</h2>
            <p className="text-gray-500 text-sm mt-1">Sostieni i commercianti del tuo quartiere</p>
          </div>
          <Link href="/stores" className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-semibold text-sm">
            Tutti i negozi <ArrowRight size={16} strokeWidth={2.2} />
          </Link>
        </div>
        <StoreShowcase />
      </section>

      {/* LIVE ACTIVITY FEED */}
      <section className="container mx-auto px-6 pb-8">
        <LiveActivityFeed />
      </section>

      {/* CTA VENDITORE — calmer, fact-based */}
      <section className="bg-gray-900 text-white">
        <div className="container mx-auto px-6 py-16 md:py-20 grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          <div className="space-y-5">
            <span className="inline-flex items-center gap-1.5 bg-white/10 text-white px-3 py-1 rounded-full text-xs font-semibold tracking-wide ring-1 ring-white/15">
              <ShieldCheck size={14} strokeWidth={2.4} />
              Per i venditori
            </span>
            <h2 className="text-3xl md:text-4xl font-bold leading-tight tracking-tight">
              Hai un'attività?<br />
              Portala online su MyCity.
            </h2>
            <p className="text-gray-400 text-base md:text-lg leading-relaxed">
              Vetrina dedicata, prodotti illimitati, zero commissioni sulle vendite.
              Abbonamento mensile, approvazione del team in 48 ore.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href="/sell"
                className="inline-flex items-center gap-2 bg-white text-gray-900 hover:bg-gray-100 px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                <Store size={18} strokeWidth={2.2} />
                Diventa venditore
              </Link>
              <Link
                href="/stores"
                className="inline-flex items-center gap-2 bg-transparent hover:bg-white/10 text-white border border-white/30 px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                Vedi chi vende già
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { n: '€50/mese', l: 'Abbonamento, niente commissioni sulle vendite' },
              { n: '48h',      l: 'Per l\'approvazione del negozio' },
              { n: '∞',        l: 'Prodotti pubblicabili' },
              { n: 'IBAN',     l: 'Bonifico mensile sui tuoi incassi' },
            ].map((s) => (
              <div key={s.l} className="bg-white/5 ring-1 ring-white/10 rounded-xl p-5">
                <div className="text-2xl md:text-3xl font-bold mb-2">{s.n}</div>
                <div className="text-xs text-gray-400 leading-snug">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

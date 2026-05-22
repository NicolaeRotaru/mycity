import Link from 'next/link';
import ProductGrid from '@/components/ProductGrid';
import CategoryShowcase from '@/components/CategoryShowcase';
import StoreShowcase from '@/components/StoreShowcase';
import ValueProps from '@/components/ValueProps';

export default function Home() {
  return (
    <div>
      {/* HERO */}
      <section className="relative bg-gradient-to-br from-indigo-700 via-purple-700 to-pink-600 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_30%_20%,white_0,transparent_50%),radial-gradient(circle_at_70%_60%,white_0,transparent_50%)]" />
        <div className="container mx-auto px-6 py-20 relative">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="space-y-6">
              <span className="inline-block bg-white/15 backdrop-blur border border-white/30 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
                ⭐ Il mercato della tua città, online
              </span>
              <h1 className="text-4xl md:text-6xl font-extrabold leading-tight">
                Compra <span className="text-yellow-300">locale</span>,<br />
                ricevi a casa
              </h1>
              <p className="text-lg md:text-xl text-indigo-100 max-w-xl">
                Frutta fresca, abbigliamento, casa: tutto dai negozi di fiducia della tua città.
                <strong className="text-white"> Paghi alla consegna</strong>, niente carte di credito.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/search"
                  className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 px-7 py-3.5 rounded-lg font-bold shadow-lg hover:shadow-xl hover:scale-105 transition-all"
                >
                  🛒 Inizia ad acquistare
                </Link>
                <Link
                  href="/stores"
                  className="bg-white/10 hover:bg-white/20 backdrop-blur border-2 border-white/40 px-7 py-3.5 rounded-lg font-bold transition-all"
                >
                  Esplora i negozi
                </Link>
              </div>
              <div className="flex flex-wrap gap-6 pt-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">✅</span>
                  <span>Spedizione gratuita sopra €30</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">✅</span>
                  <span>Reso facile entro 14 giorni</span>
                </div>
              </div>
            </div>

            <div className="hidden md:flex justify-center">
              <div className="relative">
                <div className="text-[200px] leading-none drop-shadow-2xl">🛒</div>
                <div className="absolute -top-6 -right-6 bg-yellow-400 text-gray-900 px-4 py-2 rounded-full font-bold text-sm shadow-xl rotate-12">
                  100% locale
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <ValueProps />

      {/* CATEGORIE */}
      <section className="container mx-auto px-6 py-12">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-extrabold">Cosa cerchi oggi?</h2>
          <p className="text-gray-500 mt-1">Tutte le categorie del mercato locale</p>
        </div>
        <CategoryShowcase />
      </section>

      {/* PRODOTTI IN EVIDENZA */}
      <section className="bg-gray-100 py-12">
        <div className="container mx-auto px-6">
          <div className="flex justify-between items-end mb-6">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-pink-600">🔥 In evidenza</span>
              <h2 className="text-3xl font-extrabold">I prodotti più amati</h2>
            </div>
            <Link href="/search" className="text-indigo-600 hover:underline font-semibold hidden sm:inline">
              Vedi tutto →
            </Link>
          </div>
          <ProductGrid limit={8} />
        </div>
      </section>

      {/* NEGOZI */}
      <section className="container mx-auto px-6 py-12">
        <div className="flex justify-between items-end mb-6">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">🏪 Vicino a te</span>
            <h2 className="text-3xl font-extrabold">Negozi della tua città</h2>
            <p className="text-gray-500 text-sm mt-1">Sostieni i commercianti della tua città</p>
          </div>
          <Link href="/stores" className="text-indigo-600 hover:underline font-semibold hidden sm:inline">
            Tutti i negozi →
          </Link>
        </div>
        <StoreShowcase />
      </section>

      {/* CTA VENDITORE */}
      <section className="bg-gradient-to-r from-pink-600 to-rose-600 text-white">
        <div className="container mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div className="space-y-4">
            <span className="inline-block bg-white/20 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
              💼 Per i venditori
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold">Hai un negozio nella tua città? Vendi online in 5 minuti</h2>
            <p className="text-pink-100 text-lg">
              Nessuna commissione mensile, nessun setup tecnico. Pubblica i tuoi prodotti e raggiungi i clienti della tua città.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href="/sign-up"
                className="bg-white text-pink-700 px-7 py-3.5 rounded-lg font-bold shadow-lg hover:shadow-xl hover:scale-105 transition-all"
              >
                🚀 Diventa venditore ora
              </Link>
              <Link
                href="/stores"
                className="bg-white/10 hover:bg-white/20 backdrop-blur border-2 border-white/40 px-7 py-3.5 rounded-lg font-bold transition-all"
              >
                Vedi chi vende già
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[
              { n: '0€',       l: 'Costi di iscrizione' },
              { n: '5 min',    l: 'Per pubblicare un prodotto' },
              { n: '24h',      l: 'Approvazione del negozio' },
              { n: '100%',     l: 'Della tua vendita è tua' },
            ].map((s) => (
              <div key={s.l} className="bg-white/10 backdrop-blur border border-white/20 rounded-xl p-5">
                <div className="text-3xl md:text-4xl font-extrabold mb-1">{s.n}</div>
                <div className="text-xs text-pink-100 uppercase tracking-wide">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

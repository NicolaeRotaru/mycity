import Link from 'next/link';
import ProductGrid from '@/components/ProductGrid';
import CategoryShowcase from '@/components/CategoryShowcase';
import StoreShowcase from '@/components/StoreShowcase';

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white">
        <div className="container mx-auto px-6 py-16 flex flex-col md:flex-row items-center gap-8">
          <div className="flex-1 space-y-4">
            <h1 className="text-4xl md:text-5xl font-extrabold">Il mercato locale di Piacenza</h1>
            <p className="text-lg text-indigo-100">
              Scopri prodotti freschi dai negozi della tua città. Consegna a domicilio, pagamento in contanti.
            </p>
            <div className="flex gap-3 flex-wrap">
              <Link href="/search" className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-6 py-3 rounded-lg font-bold">
                Acquista ora
              </Link>
              <Link href="/sell" className="bg-white/10 hover:bg-white/20 border border-white/40 px-6 py-3 rounded-lg font-bold">
                Vendi i tuoi prodotti
              </Link>
            </div>
          </div>
          <div className="hidden md:block text-9xl">🛒</div>
        </div>
      </section>

      <section className="container mx-auto px-6">
        <h2 className="text-2xl font-bold mb-6">Esplora le categorie</h2>
        <CategoryShowcase />
      </section>

      <section className="container mx-auto px-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Prodotti in evidenza</h2>
          <Link href="/search" className="text-indigo-600 hover:underline">Vedi tutto →</Link>
        </div>
        <ProductGrid limit={8} />
      </section>

      <section className="container mx-auto px-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Negozi a Piacenza</h2>
          <Link href="/stores" className="text-indigo-600 hover:underline">Tutti i negozi →</Link>
        </div>
        <StoreShowcase />
      </section>
    </div>
  );
}

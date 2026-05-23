import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container mx-auto px-6 py-20 max-w-2xl text-center">
      <div className="text-7xl md:text-9xl font-extrabold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
        404
      </div>
      <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 mt-4 mb-3">
        Pagina non trovata
      </h1>
      <p className="text-gray-600 mb-8 max-w-md mx-auto">
        Sembra che il negozio sia chiuso o questa pagina abbia cambiato indirizzo. Torna alla home oppure cerca quello che ti serve.
      </p>

      <div className="flex items-center justify-center gap-3 flex-wrap mb-10">
        <Link href="/" className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-bold transition-colors">
          🏠 Torna alla home
        </Link>
        <Link href="/search" className="bg-gray-100 hover:bg-gray-200 text-gray-900 px-6 py-3 rounded-lg font-bold transition-colors">
          🔍 Cerca prodotti
        </Link>
        <Link href="/stores" className="bg-gray-100 hover:bg-gray-200 text-gray-900 px-6 py-3 rounded-lg font-bold transition-colors">
          🏪 Tutti i negozi
        </Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-6 text-left">
        <h3 className="font-bold text-gray-900 mb-3">Link utili</h3>
        <ul className="grid sm:grid-cols-2 gap-2 text-sm">
          <li><Link href="/faq" className="text-indigo-600 hover:underline">📖 Domande frequenti</Link></li>
          <li><Link href="/help" className="text-indigo-600 hover:underline">💡 Centro assistenza</Link></li>
          <li><Link href="/contact" className="text-indigo-600 hover:underline">✉️ Contattaci</Link></li>
          <li><Link href="/near" className="text-indigo-600 hover:underline">📍 Negozi vicino a te</Link></li>
          <li><Link href="/orders" className="text-indigo-600 hover:underline">📦 I miei ordini</Link></li>
          <li><Link href="/cart" className="text-indigo-600 hover:underline">🛒 Carrello</Link></li>
        </ul>
      </div>
    </div>
  );
}

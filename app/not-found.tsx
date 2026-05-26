import Link from 'next/link';
import { Button } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <div className="container mx-auto px-6 py-20 max-w-2xl text-center">
      <div className="text-7xl md:text-9xl font-extrabold bg-gradient-to-r from-primary-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
        404
      </div>
      <h1 className="text-2xl md:text-3xl font-extrabold text-ink-900 mt-4 mb-3">
        Pagina non trovata
      </h1>
      <p className="text-ink-600 mb-8 max-w-md mx-auto">
        Sembra che il negozio sia chiuso o questa pagina abbia cambiato indirizzo. Torna alla home oppure cerca quello che ti serve.
      </p>

      <div className="flex items-center justify-center gap-3 flex-wrap mb-10">
        <Button href="/" size="lg">🏠 Torna alla home</Button>
        <Button href="/search" variant="secondary" size="lg">🔍 Cerca prodotti</Button>
        <Button href="/stores" variant="secondary" size="lg">🏪 Tutti i negozi</Button>
      </div>

      <div className="bg-white border border-cream-300 rounded-2xl p-6 text-left">
        <h3 className="font-bold text-ink-900 mb-3">Link utili</h3>
        <ul className="grid sm:grid-cols-2 gap-2 text-sm">
          <li><Link href="/faq" className="text-primary-700 hover:underline">📖 Domande frequenti</Link></li>
          <li><Link href="/help" className="text-primary-700 hover:underline">💡 Centro assistenza</Link></li>
          <li><Link href="/contact" className="text-primary-700 hover:underline">✉️ Contattaci</Link></li>
          <li><Link href="/near" className="text-primary-700 hover:underline">📍 Negozi vicino a te</Link></li>
          <li><Link href="/orders" className="text-primary-700 hover:underline">📦 I miei ordini</Link></li>
          <li><Link href="/cart" className="text-primary-700 hover:underline">🛒 Carrello</Link></li>
        </ul>
      </div>
    </div>
  );
}

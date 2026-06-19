import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Home, Search, Store, BookOpen, Lightbulb, Mail, MapPin, Package, ShoppingCart } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="container mx-auto px-6 py-20 max-w-2xl text-center">
      <div className="text-7xl md:text-9xl font-extrabold font-serif bg-gradient-to-r from-primary-600 via-primary-700 to-secondary-600 bg-clip-text text-transparent">
        404
      </div>
      <h1 className="text-2xl md:text-3xl font-extrabold text-ink-900 mt-4 mb-3">
        Pagina non trovata
      </h1>
      <p className="text-ink-600 mb-8 max-w-md mx-auto">
        Sembra che il negozio sia chiuso o questa pagina abbia cambiato indirizzo. Torna alla home oppure cerca quello che ti serve.
      </p>

      <div className="flex items-center justify-center gap-3 flex-wrap mb-10">
        <Button href="/" size="lg"><span className="inline-flex items-center gap-2"><Home size={20} aria-hidden /> Torna alla home</span></Button>
        <Button href="/search" variant="secondary" size="lg"><span className="inline-flex items-center gap-2"><Search size={20} aria-hidden /> Cerca prodotti</span></Button>
        <Button href="/stores" variant="secondary" size="lg"><span className="inline-flex items-center gap-2"><Store size={20} aria-hidden /> Tutti i negozi</span></Button>
      </div>

      <div className="bg-white border border-cream-300 rounded-2xl p-6 text-left">
        <h3 className="font-bold text-ink-900 mb-3">Link utili</h3>
        <ul className="grid sm:grid-cols-2 gap-2 text-sm">
          <li><Link href="/faq" className="inline-flex items-center gap-2 text-primary-700 hover:underline"><BookOpen size={16} className="shrink-0" aria-hidden /> Domande frequenti</Link></li>
          <li><Link href="/help" className="inline-flex items-center gap-2 text-primary-700 hover:underline"><Lightbulb size={16} className="shrink-0" aria-hidden /> Centro assistenza</Link></li>
          <li><Link href="/contact" className="inline-flex items-center gap-2 text-primary-700 hover:underline"><Mail size={16} className="shrink-0" aria-hidden /> Contattaci</Link></li>
          <li><Link href="/near" className="inline-flex items-center gap-2 text-primary-700 hover:underline"><MapPin size={16} className="shrink-0" aria-hidden /> Negozi vicino a te</Link></li>
          <li><Link href="/orders" className="inline-flex items-center gap-2 text-primary-700 hover:underline"><Package size={16} className="shrink-0" aria-hidden /> I miei ordini</Link></li>
          <li><Link href="/cart" className="inline-flex items-center gap-2 text-primary-700 hover:underline"><ShoppingCart size={16} className="shrink-0" aria-hidden /> Carrello</Link></li>
        </ul>
      </div>
    </div>
  );
}

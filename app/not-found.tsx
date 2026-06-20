import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Home, Search, Store, BookOpen, Lightbulb, Mail, MapPin, Package, ShoppingCart } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="container mx-auto px-6 py-20 max-w-2xl text-center">
      <p className="font-serif text-7xl md:text-9xl font-extrabold text-primary-700 leading-none tracking-[-0.02em] mb-2">
        404
      </p>
      <h1 className="font-serif text-2xl md:text-3xl font-extrabold text-ink-900 mt-2 mb-3">
        Pagina non trovata
      </h1>
      <p className="text-ink-600 mb-8 max-w-md mx-auto">
        La pagina che cerchi non esiste o è stata spostata. Ma i negozi di Piacenza sono sempre qui.
      </p>

      <div className="flex items-center justify-center gap-3 flex-wrap mb-10">
        <Button href="/" size="lg"><span className="inline-flex items-center gap-2"><Home size={20} aria-hidden /> Torna alla home</span></Button>
        <Button href="/stores" variant="secondary" size="lg"><span className="inline-flex items-center gap-2"><Store size={20} aria-hidden /> Esplora i negozi</span></Button>
        <Button href="/search" variant="secondary" size="lg"><span className="inline-flex items-center gap-2"><Search size={20} aria-hidden /> Cerca prodotti</span></Button>
      </div>

      <div className="bg-white border border-cream-300 rounded-2xl p-6 text-left">
        <h2 className="font-bold text-ink-900 mb-3">Link utili</h2>
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

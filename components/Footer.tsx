'use client';

import Link from 'next/link';
import { useProfile } from './hooks/useProfile';

const Footer = () => {
  const { isSeller, isBuyer, isAuthenticated, isLoading } = useProfile();
  const isSellerArea = isSeller;
  const isAuthUnknownRole = isAuthenticated && !isBuyer && !isSeller;

  return (
    <footer className="bg-gray-900 text-gray-300 mt-12">
      {/* CTA banner finale */}
      {!isSellerArea && (
        <div className="bg-gradient-to-r from-indigo-700 via-purple-700 to-pink-600">
          <div className="container mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4 text-white">
            <div>
              <h3 className="text-xl md:text-2xl font-extrabold">Hai un'attività a Piacenza?</h3>
              <p className="text-indigo-100 text-sm">Inizia a vendere online in 5 minuti. Zero commissioni mensili.</p>
            </div>
            <Link
              href={isAuthenticated ? '/sell' : '/sign-up'}
              className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 px-7 py-3 rounded-lg font-bold whitespace-nowrap shadow-lg hover:scale-105 transition-all"
            >
              🚀 Diventa venditore
            </Link>
          </div>
        </div>
      )}

      <div className="container mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
        <div>
          <h3 className="font-bold text-white mb-3 flex items-center gap-2">
            <span className="text-indigo-400">●</span> Piacenza Market
          </h3>
          <ul className="space-y-2 text-sm">
            <li><Link href="/" className="hover:text-white transition-colors">Home</Link></li>
            <li><Link href="/stores" className="hover:text-white transition-colors">Negozi locali</Link></li>
            <li><Link href="/search" className="hover:text-white transition-colors">Tutti i prodotti</Link></li>
          </ul>
        </div>

        {isSellerArea ? (
          <div>
            <h3 className="font-bold text-white mb-3">Il tuo negozio</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/seller/dashboard" className="hover:text-white transition-colors">Dashboard</Link></li>
              <li><Link href="/seller/products" className="hover:text-white transition-colors">I tuoi prodotti</Link></li>
              <li><Link href="/seller/products/new" className="hover:text-white transition-colors">Pubblica</Link></li>
              <li><Link href="/seller/orders" className="hover:text-white transition-colors">Ordini ricevuti</Link></li>
            </ul>
          </div>
        ) : (
          <div>
            <h3 className="font-bold text-white mb-3">Categorie</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/category/alimentari" className="hover:text-white transition-colors">🍎 Alimentari</Link></li>
              <li><Link href="/category/abbigliamento" className="hover:text-white transition-colors">👕 Abbigliamento</Link></li>
              <li><Link href="/category/casa" className="hover:text-white transition-colors">🏠 Casa & Cucina</Link></li>
              <li><Link href="/category/elettronica" className="hover:text-white transition-colors">💻 Elettronica</Link></li>
            </ul>
          </div>
        )}

        <div>
          <h3 className="font-bold text-white mb-3">Account</h3>
          <ul className="space-y-2 text-sm">
            {!isAuthenticated && !isLoading && (
              <>
                <li><Link href="/sign-in" className="hover:text-white transition-colors">Accedi</Link></li>
                <li><Link href="/sign-up" className="hover:text-white transition-colors">Registrati</Link></li>
              </>
            )}
            {isAuthUnknownRole && (
              <li><Link href="/profile" className="hover:text-white transition-colors">Il tuo account</Link></li>
            )}
            {isBuyer && (
              <>
                <li><Link href="/profile" className="hover:text-white transition-colors">Il tuo account</Link></li>
                <li><Link href="/orders" className="hover:text-white transition-colors">I tuoi ordini</Link></li>
                <li><Link href="/cart" className="hover:text-white transition-colors">Carrello</Link></li>
              </>
            )}
            {isSellerArea && (
              <>
                <li><Link href="/seller/profile" className="hover:text-white transition-colors">Profilo negozio</Link></li>
                <li><Link href="/seller/orders" className="hover:text-white transition-colors">Ordini ricevuti</Link></li>
              </>
            )}
          </ul>
        </div>

        <div>
          <h3 className="font-bold text-white mb-3">Assistenza</h3>
          <ul className="space-y-2 text-sm">
            <li className="text-gray-400">📧 info@piacenzamarket.it</li>
            <li className="text-gray-400">📞 Lun-Ven 9-18</li>
            <li className="text-gray-400">🏘️ Piacenza, Italia</li>
          </ul>
          <div className="flex gap-2 mt-4">
            <span className="w-9 h-9 bg-white/5 hover:bg-white/15 rounded-full flex items-center justify-center cursor-pointer transition-colors" title="Facebook">f</span>
            <span className="w-9 h-9 bg-white/5 hover:bg-white/15 rounded-full flex items-center justify-center cursor-pointer transition-colors" title="Instagram">📷</span>
            <span className="w-9 h-9 bg-white/5 hover:bg-white/15 rounded-full flex items-center justify-center cursor-pointer transition-colors" title="WhatsApp">💬</span>
          </div>
        </div>
      </div>

      {/* Trust strip */}
      <div className="border-t border-gray-800">
        <div className="container mx-auto px-6 py-5 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-gray-400">
          <div className="flex items-center gap-4 flex-wrap justify-center">
            <span className="flex items-center gap-1">💰 Pagamento alla consegna</span>
            <span className="flex items-center gap-1">🚚 Spedizione 24-48h</span>
            <span className="flex items-center gap-1">🔒 Acquisto sicuro</span>
            <span className="flex items-center gap-1">↩️ Reso entro 14 giorni</span>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-800 py-4 text-center text-xs text-gray-500">
        © {new Date().getFullYear()} Piacenza Market · Il mercato locale della tua città · P.IVA 00000000000
      </div>
    </footer>
  );
};

export default Footer;

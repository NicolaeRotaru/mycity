'use client';

import Link from 'next/link';
import { useProfile } from './hooks/useProfile';

const Footer = () => {
  const { isSeller, isPendingSeller, isBuyer, isAuthenticated } = useProfile();
  const isSellerArea = isSeller || isPendingSeller;

  return (
    <footer className="bg-gray-900 text-gray-300 mt-12">
      <div className="container mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
        <div>
          <h3 className="font-bold text-white mb-3">Piacenza Market</h3>
          <ul className="space-y-2 text-sm">
            <li><Link href="/" className="hover:underline">Home</Link></li>
            <li><Link href="/stores" className="hover:underline">Negozi locali</Link></li>
            <li><Link href="/search" className="hover:underline">Tutti i prodotti</Link></li>
          </ul>
        </div>

        {/* Sezione che cambia in base al ruolo */}
        {isSellerArea ? (
          <div>
            <h3 className="font-bold text-white mb-3">Il tuo negozio</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/seller/dashboard" className="hover:underline">Dashboard</Link></li>
              <li><Link href="/seller/products" className="hover:underline">I tuoi prodotti</Link></li>
              <li><Link href="/seller/products/new" className="hover:underline">Pubblica un prodotto</Link></li>
              <li><Link href="/seller/orders" className="hover:underline">Ordini ricevuti</Link></li>
              <li><Link href="/seller/profile" className="hover:underline">Profilo negozio</Link></li>
            </ul>
          </div>
        ) : (
          <div>
            <h3 className="font-bold text-white mb-3">Categorie</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/category/alimentari" className="hover:underline">Alimentari</Link></li>
              <li><Link href="/category/abbigliamento" className="hover:underline">Abbigliamento</Link></li>
              <li><Link href="/category/casa" className="hover:underline">Casa & Cucina</Link></li>
              <li><Link href="/category/elettronica" className="hover:underline">Elettronica</Link></li>
            </ul>
          </div>
        )}

        {/* Sezione "Vendi" — visibile solo se non sei già seller */}
        {!isSellerArea && (
          <div>
            <h3 className="font-bold text-white mb-3">Vendi</h3>
            <ul className="space-y-2 text-sm">
              {isAuthenticated ? (
                <li><Link href="/sell" className="hover:underline">Diventa venditore</Link></li>
              ) : (
                <li><Link href="/sign-up" className="hover:underline">Registrati come venditore</Link></li>
              )}
              <li><Link href="/stores" className="hover:underline">Esplora i negozi</Link></li>
            </ul>
          </div>
        )}

        {/* Sezione "Account" — sempre presente ma con link diversi */}
        <div>
          <h3 className="font-bold text-white mb-3">Account</h3>
          <ul className="space-y-2 text-sm">
            {!isAuthenticated && (
              <>
                <li><Link href="/sign-in" className="hover:underline">Accedi</Link></li>
                <li><Link href="/sign-up" className="hover:underline">Registrati</Link></li>
              </>
            )}
            {isBuyer && (
              <>
                <li><Link href="/profile" className="hover:underline">Il tuo account</Link></li>
                <li><Link href="/orders" className="hover:underline">I tuoi ordini</Link></li>
                <li><Link href="/cart" className="hover:underline">Il tuo carrello</Link></li>
              </>
            )}
            {isSellerArea && (
              <>
                <li><Link href="/seller/profile" className="hover:underline">Profilo negozio</Link></li>
                <li><Link href="/seller/orders" className="hover:underline">Ordini ricevuti</Link></li>
              </>
            )}
          </ul>
        </div>
      </div>

      <div className="border-t border-gray-700 py-4 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} Piacenza Market · Il mercato locale della tua città
      </div>
    </footer>
  );
};

export default Footer;

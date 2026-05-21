import Link from 'next/link';

const Footer = () => (
  <footer className="bg-gray-900 text-gray-300 mt-12">
    <div className="container mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
      <div>
        <h3 className="font-bold text-white mb-3">Conosci Piacenza Market</h3>
        <ul className="space-y-2 text-sm">
          <li><Link href="/" className="hover:underline">Chi siamo</Link></li>
          <li><Link href="/stores" className="hover:underline">Negozi locali</Link></li>
          <li><Link href="/" className="hover:underline">Contattaci</Link></li>
        </ul>
      </div>
      <div>
        <h3 className="font-bold text-white mb-3">Acquista</h3>
        <ul className="space-y-2 text-sm">
          <li><Link href="/search" className="hover:underline">Tutti i prodotti</Link></li>
          <li><Link href="/category/alimentari" className="hover:underline">Alimentari</Link></li>
          <li><Link href="/category/abbigliamento" className="hover:underline">Abbigliamento</Link></li>
          <li><Link href="/category/casa" className="hover:underline">Casa & Cucina</Link></li>
        </ul>
      </div>
      <div>
        <h3 className="font-bold text-white mb-3">Vendi</h3>
        <ul className="space-y-2 text-sm">
          <li><Link href="/sell" className="hover:underline">Diventa venditore</Link></li>
          <li><Link href="/seller/dashboard" className="hover:underline">Area venditori</Link></li>
          <li><Link href="/seller/products/new" className="hover:underline">Pubblica un prodotto</Link></li>
        </ul>
      </div>
      <div>
        <h3 className="font-bold text-white mb-3">Assistenza</h3>
        <ul className="space-y-2 text-sm">
          <li><Link href="/orders" className="hover:underline">I tuoi ordini</Link></li>
          <li><Link href="/profile" className="hover:underline">Il tuo account</Link></li>
          <li><Link href="/cart" className="hover:underline">Il tuo carrello</Link></li>
        </ul>
      </div>
    </div>
    <div className="border-t border-gray-700 py-4 text-center text-xs text-gray-400">
      © {new Date().getFullYear()} Piacenza Market · Il mercato locale della tua città
    </div>
  </footer>
);

export default Footer;

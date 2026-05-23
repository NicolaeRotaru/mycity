'use client';

import Link from 'next/link';
import { useProfile } from './hooks/useProfile';
import NewsletterForm from './NewsletterForm';

const SOCIALS = [
  {
    name: 'Facebook',
    href: 'https://www.facebook.com/mycitypiacenza',
    color: 'hover:bg-[#1877F2]',
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.017 1.792-4.683 4.533-4.683 1.312 0 2.686.235 2.686.235v2.97h-1.514c-1.491 0-1.956.93-1.956 1.886v2.262h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
      </svg>
    ),
  },
  {
    name: 'Instagram',
    href: 'https://www.instagram.com/mycitypiacenza',
    color: 'hover:bg-gradient-to-tr hover:from-yellow-500 hover:via-pink-500 hover:to-purple-600',
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
      </svg>
    ),
  },
  {
    name: 'TikTok',
    href: 'https://www.tiktok.com/@mycitypiacenza',
    color: 'hover:bg-black',
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005.8 20.1a6.34 6.34 0 0010.86-4.43V8.79a8.16 8.16 0 004.77 1.52V6.85a4.85 4.85 0 01-1.84-.16z" />
      </svg>
    ),
  },
  {
    name: 'X',
    href: 'https://x.com/mycitypiacenza',
    color: 'hover:bg-black',
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    name: 'LinkedIn',
    href: 'https://www.linkedin.com/company/mycitypiacenza',
    color: 'hover:bg-[#0A66C2]',
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.852 3.37-1.852 3.601 0 4.267 2.37 4.267 5.455v6.288zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  {
    name: 'YouTube',
    href: 'https://www.youtube.com/@mycitypiacenza',
    color: 'hover:bg-[#FF0000]',
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
  {
    name: 'WhatsApp',
    href: 'https://wa.me/393000000000',
    color: 'hover:bg-[#25D366]',
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
      </svg>
    ),
  },
];

const Footer = () => {
  const { isSeller, isRider, isAuthenticated } = useProfile();
  const isSellerArea = isSeller || isRider;

  return (
    <footer className="bg-gray-900 text-gray-300 mt-12">
      {/* CTA banner finale */}
      {!isSellerArea && (
        <div className="bg-gradient-to-r from-indigo-700 via-purple-700 to-pink-600">
          <div className="container mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4 text-white">
            <div>
              <h3 className="text-xl md:text-2xl font-extrabold">Hai un'attività nella tua città?</h3>
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

      <div className={`container mx-auto px-6 py-12 grid grid-cols-2 ${isSellerArea ? 'md:grid-cols-4' : 'md:grid-cols-5'} gap-8`}>
        {/* Brand + descrizione */}
        <div className="col-span-2 md:col-span-1">
          <h3 className="font-bold text-white mb-3 flex items-center gap-2 text-lg">
            <span className="text-indigo-400">●</span> MyCity
          </h3>
          <p className="text-sm text-gray-400 mb-4 leading-relaxed">
            Il marketplace dei negozi di Piacenza. Compra dai commercianti locali, ricevi a casa in 24-48h.
          </p>
          {/* Social icons */}
          <div className="flex flex-wrap gap-2">
            {SOCIALS.map((s) => (
              <a
                key={s.name}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                title={s.name}
                aria-label={s.name}
                className={`w-9 h-9 bg-white/5 ${s.color} hover:text-white rounded-full flex items-center justify-center transition-all duration-200`}
              >
                {s.svg}
              </a>
            ))}
          </div>
        </div>

        {/* Esplora */}
        <div>
          <h3 className="font-bold text-white mb-3 text-sm uppercase tracking-wide">Esplora</h3>
          <ul className="space-y-2 text-sm">
            <li><Link href={isSellerArea ? '/?as=buyer' : '/'} className="hover:text-white transition-colors">Home</Link></li>
            <li><Link href="/stores" className="hover:text-white transition-colors">Negozi locali</Link></li>
            <li><Link href="/near" className="hover:text-white transition-colors">Vicino a te</Link></li>
            <li><Link href="/groups" className="hover:text-white transition-colors">Gruppi d'acquisto</Link></li>
            <li><Link href="/search" className="hover:text-white transition-colors">Tutti i prodotti</Link></li>
          </ul>
        </div>

        {/* Categorie — solo per buyer/guest. Per seller/rider la navigazione
            del loro mestiere è nella sidebar dedicata, niente duplicati qui. */}
        {!isSellerArea && (
          <div>
            <h3 className="font-bold text-white mb-3 text-sm uppercase tracking-wide">Categorie</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/category/alimentari" className="hover:text-white transition-colors">🍎 Alimentari</Link></li>
              <li><Link href="/category/abbigliamento" className="hover:text-white transition-colors">👕 Abbigliamento</Link></li>
              <li><Link href="/category/casa" className="hover:text-white transition-colors">🏠 Casa & Cucina</Link></li>
              <li><Link href="/category/elettronica" className="hover:text-white transition-colors">💻 Elettronica</Link></li>
              <li><Link href="/category/libri" className="hover:text-white transition-colors">📚 Libri</Link></li>
            </ul>
          </div>
        )}

        {/* Aiuto */}
        <div>
          <h3 className="font-bold text-white mb-3 text-sm uppercase tracking-wide">Aiuto</h3>
          <ul className="space-y-2 text-sm">
            <li><Link href="/help" className="hover:text-white transition-colors">Centro assistenza</Link></li>
            <li><Link href="/faq" className="hover:text-white transition-colors">Domande frequenti</Link></li>
            <li><Link href="/contact" className="hover:text-white transition-colors">Contattaci</Link></li>
            <li><Link href="/shipping" className="hover:text-white transition-colors">Spedizioni</Link></li>
            <li><Link href="/returns" className="hover:text-white transition-colors">Resi e rimborsi</Link></li>
            {isAuthenticated && (
              <li><Link href="/profile/settings" className="hover:text-white transition-colors">Impostazioni account</Link></li>
            )}
          </ul>
        </div>

        {/* Azienda + Legale */}
        <div>
          <h3 className="font-bold text-white mb-3 text-sm uppercase tracking-wide">Azienda</h3>
          <ul className="space-y-2 text-sm">
            <li><Link href="/about" className="hover:text-white transition-colors">Chi siamo</Link></li>
            <li><Link href="/sell" className="hover:text-white transition-colors">Vendi su MyCity</Link></li>
            <li><Link href="/terms" className="hover:text-white transition-colors">Termini di servizio</Link></li>
            <li><Link href="/privacy" className="hover:text-white transition-colors">Privacy policy</Link></li>
            <li><Link href="/cookies" className="hover:text-white transition-colors">Cookie policy</Link></li>
          </ul>
        </div>
      </div>

      {/* Newsletter */}
      {!isSellerArea && (
        <div className="border-t border-gray-800 bg-gray-950">
          <div className="container mx-auto px-6 py-6 max-w-2xl">
            <NewsletterForm />
          </div>
        </div>
      )}

      {/* Trust strip + contatti compatti */}
      <div className="border-t border-gray-800">
        <div className="container mx-auto px-6 py-5 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-gray-400">
          <div className="flex items-center gap-4 flex-wrap justify-center">
            <span className="flex items-center gap-1">💰 Pagamento alla consegna</span>
            <span className="flex items-center gap-1">🚚 Spedizione 24-48h</span>
            <span className="flex items-center gap-1">🔒 Acquisto sicuro</span>
            <span className="flex items-center gap-1">↩️ Reso entro 14 giorni</span>
          </div>
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-gray-500 justify-center">
            <a href="mailto:info@mycity.it" className="hover:text-gray-300 transition-colors">📧 info@mycity.it</a>
            <span>📞 Lun–Ven 9–18</span>
            <span>🏘️ Piacenza, IT</span>
          </div>
        </div>
      </div>

      {/* Dati legali azienda */}
      <div className="border-t border-gray-800 py-5 text-center text-xs text-gray-500 space-y-1 px-4">
        <div>
          © {new Date().getFullYear()} <span className="font-semibold text-gray-400">MyCity S.r.l.</span> · Il mercato locale della tua città
        </div>
        <div>
          Sede legale: Via Roma 1, 29121 Piacenza (PC), Italia · P.IVA / C.F. IT00000000000 · REA PC-000000
        </div>
        <div>
          Capitale sociale € 10.000 i.v. · PEC: mycity@pec.it ·{' '}
          <Link href="/terms" className="underline hover:text-gray-300">Termini</Link> ·{' '}
          <Link href="/privacy" className="underline hover:text-gray-300">Privacy</Link> ·{' '}
          <Link href="/cookies" className="underline hover:text-gray-300">Cookie</Link>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

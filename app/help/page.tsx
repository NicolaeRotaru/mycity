import Link from 'next/link';

export const metadata = {
  title: 'Centro assistenza · MyCity',
  description: 'Trova risposte, guide e contatti per ogni tua esigenza su MyCity.',
  alternates: { canonical: '/help' },
  openGraph: {
    title: 'Centro assistenza · MyCity',
    description: 'Risposte, guide e contatti per ogni tua esigenza su MyCity.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/help',
  },
};

const TOPICS = [
  {
    icon: '🛒',
    title: 'Ordini e pagamenti',
    desc: 'Stato ordine, modifica, annullamento, pagamenti.',
    href: '/faq#ordini',
  },
  {
    icon: '🚚',
    title: 'Spedizioni',
    desc: 'Tempi, costi, ritiro in negozio, tracciamento.',
    href: '/shipping',
  },
  {
    icon: '↩️',
    title: 'Resi e rimborsi',
    desc: 'Diritto di recesso, garanzia, rimborsi.',
    href: '/returns',
  },
  {
    icon: '⚙️',
    title: 'Account e impostazioni',
    desc: 'Password, dati personali, notifiche, privacy.',
    href: '/profile/settings',
  },
  {
    icon: '🏪',
    title: 'Vendere su MyCity',
    desc: 'Apri il tuo negozio, gestisci prodotti e ordini.',
    href: '/sell',
  },
  {
    icon: '🛵',
    title: 'Diventa rider',
    desc: 'Lavora con noi consegnando ordini in città.',
    href: '/contact',
  },
];

export default function HelpPage() {
  return (
    <div className="container mx-auto px-6 py-10 max-w-5xl">
      <div className="text-center mb-10">
        <h1 className="text-3xl md:text-4xl font-extrabold text-ink-900 mb-3">Centro assistenza</h1>
        <p className="text-ink-600">Come possiamo aiutarti?</p>
      </div>

      {/* Search-like CTA */}
      <Link
        href="/faq"
        className="block bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-2xl p-8 mb-10 hover:shadow-xl transition-all"
      >
        <div className="text-center">
          <div className="text-4xl mb-2">🔎</div>
          <h2 className="text-2xl font-bold mb-1">Cerca tra le domande frequenti</h2>
          <p className="text-primary-100">Più di 25 risposte alle domande più comuni →</p>
        </div>
      </Link>

      {/* Topics grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        {TOPICS.map((t) => (
          <Link
            key={t.title}
            href={t.href}
            className="bg-white border border-cream-300 rounded-xl p-5 hover:shadow-md hover:border-primary-300 transition-all"
          >
            <div className="text-3xl mb-2">{t.icon}</div>
            <div className="font-bold text-ink-900 mb-1">{t.title}</div>
            <div className="text-sm text-ink-600">{t.desc}</div>
          </Link>
        ))}
      </div>

      {/* Contact options */}
      <div className="bg-cream-50 border border-cream-300 rounded-2xl p-6">
        <h3 className="font-bold text-ink-900 mb-4 text-lg">Parla con noi direttamente</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          <a href="mailto:info@mycity.it" className="flex items-center gap-3 bg-white border rounded-lg p-3 hover:border-primary-300 transition-colors">
            <span className="text-2xl">📧</span>
            <div>
              <div className="font-semibold text-sm">Email</div>
              <div className="text-xs text-ink-500">info@mycity.it</div>
            </div>
          </a>
          <a href="https://wa.me/393000000000" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 bg-white border rounded-lg p-3 hover:border-green-300 transition-colors">
            <span className="text-2xl">💬</span>
            <div>
              <div className="font-semibold text-sm">WhatsApp</div>
              <div className="text-xs text-ink-500">Lun-Ven 9-18</div>
            </div>
          </a>
          <Link href="/contact" className="flex items-center gap-3 bg-white border rounded-lg p-3 hover:border-primary-300 transition-colors">
            <span className="text-2xl">📝</span>
            <div>
              <div className="font-semibold text-sm">Form contatti</div>
              <div className="text-xs text-ink-500">Risposta entro 24h</div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}

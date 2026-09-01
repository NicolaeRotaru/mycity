import Link from 'next/link';
import { Lightbulb, Mail, MessageCircle, BookOpen } from 'lucide-react';
import { linkWhatsApp } from '@/lib/contatto-whatsapp';
import { TOPICS } from './domande';

export const metadata = {
  title: 'Centro venditori · MyCity',
};

export default function SellerHelpPage() {
  const whatsapp = linkWhatsApp(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER, 'Ciao MyCity, ho una domanda');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-ink-900 flex items-center gap-2"><Lightbulb size={28} className="text-accent-500" aria-hidden /> Centro venditori</h1>
        <p className="text-sm text-ink-500">Guide e risposte rapide per gestire il tuo negozio al meglio.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <Link href="/contact" className="bg-gradient-to-br from-primary-600 to-secondary-600 text-white rounded-xl p-5 hover:shadow-lg transition-all">
          <div className="mb-2"><Mail size={24} className="text-white" aria-hidden /></div>
          <p className="font-bold">Contatta il team</p>
          <p className="text-xs text-primary-100 mt-1">Risposta entro 24h</p>
        </Link>
        <a href="mailto:venditori@mycity.it" className="bg-white border rounded-xl p-5 hover:shadow-md hover:border-primary-300 transition-all">
          <div className="mb-2"><Mail size={24} className="text-primary-600" aria-hidden /></div>
          <p className="font-bold text-ink-900">Email dedicata</p>
          <p className="text-xs text-ink-500 mt-1">venditori@mycity.it</p>
        </a>
        {whatsapp && (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="bg-white border rounded-xl p-5 hover:shadow-md hover:border-green-300 transition-all">
            <div className="mb-2"><MessageCircle size={24} className="text-olive-600" aria-hidden /></div>
            <p className="font-bold text-ink-900">WhatsApp</p>
            <p className="text-xs text-ink-500 mt-1">Lun-Ven 9-18</p>
          </a>
        )}
      </div>

      <div className="space-y-6">
        {TOPICS.map((topic) => (
          <section key={topic.title} className="bg-white border rounded-xl p-5">
            <h2 className="font-bold text-ink-900 mb-3 flex items-center gap-2 text-lg">
              <topic.icon size={24} className="text-primary-600" aria-hidden /> {topic.title}
            </h2>
            <div className="space-y-3">
              {topic.items.map((it) => (
                <details key={it.q} className="group">
                  <summary className="cursor-pointer font-semibold text-ink-800 hover:text-primary-700 list-none flex items-start justify-between gap-2">
                    <span>{it.q}</span>
                    <span className="text-ink-400 group-open:rotate-45 transition-transform text-xl leading-none">+</span>
                  </summary>
                  <p className="text-sm text-ink-600 mt-2 leading-relaxed pl-1">{it.a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="bg-accent-50 border border-accent-200 rounded-xl p-5 text-sm text-accent-900">
        <p className="font-bold mb-1 flex items-center gap-2"><BookOpen size={18} className="text-accent-500" aria-hidden /> Guide approfondite (prossimamente)</p>
        <p>Stiamo preparando una academy con video tutorial per ogni funzionalità. Iscriviti alla newsletter per essere avvisato.</p>
      </div>
    </div>
  );
}

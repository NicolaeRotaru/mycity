import Link from 'next/link';
import { Banknote, ShieldCheck, RotateCcw, ArrowRight, Store } from 'lucide-react';
import HowItWorks from '@/components/home/HowItWorks';

export const metadata = {
  title: 'Come funziona · MyCity',
  description:
    'Come funziona MyCity: scegli dai negozi di Piacenza, ordini in pochi tap e paghi alla consegna. Te lo portiamo a casa in 24-48h, reso entro 14 giorni.',
  alternates: { canonical: '/come-funziona' },
  openGraph: {
    title: 'Come funziona · MyCity',
    description: 'Scegli dai negozi locali, ordini e paghi alla consegna. Zero rischi.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/come-funziona',
  },
};

const REASSURANCE = [
  {
    Icon: Banknote,
    title: 'Paghi alla consegna',
    desc: 'In contanti al rider, quando arriva. Niente carta, nessun rischio.',
  },
  {
    Icon: RotateCcw,
    title: 'Reso entro 14 giorni',
    desc: 'Cambi idea? Ti rimborsiamo senza domande.',
  },
  {
    Icon: ShieldCheck,
    title: "L'account serve solo a confermare",
    desc: "Carrello e indirizzo li compili da ospite. L'account serve solo per confermare l'ordine.",
  },
];

export default function ComeFunzionaPage() {
  return (
    <div>
      {/* Hero */}
      <section className="container mx-auto max-w-3xl px-4 sm:px-6 pt-10 pb-2 text-center">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary-700">
          Semplice e senza pensieri
        </span>
        <h1 className="mt-2 font-serif text-3xl font-bold leading-[1.05] text-ink-900 md:text-5xl">
          I negozi <em className="italic text-primary-600">veri</em> di Piacenza,
          <br className="hidden sm:block" /> ora a casa tua
        </h1>
        <p className="mt-4 text-lg text-ink-600">
          Ordini dai negozi della tua città e <strong>paghi alla consegna</strong>. Te lo portiamo a casa in 24-48h.
        </p>
      </section>

      {/* I 3 passi — riuso del componente della home */}
      <HowItWorks />

      {/* Banda rassicurazione */}
      <section className="container mx-auto px-4 sm:px-6 py-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {REASSURANCE.map((r) => (
            <div key={r.title} className="rounded-2xl border border-cream-300 bg-white p-5 shadow-warm-sm">
              <div className="mb-2 flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-olive-50 text-olive-700">
                  <r.Icon size={20} strokeWidth={2.2} aria-hidden />
                </span>
                <h2 className="font-serif font-bold text-ink-900">{r.title}</h2>
              </div>
              <p className="text-sm leading-relaxed text-ink-600">{r.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA finale */}
      <section className="container mx-auto px-4 sm:px-6 pb-12">
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/categorie"
            className="group flex items-center justify-between gap-3 rounded-2xl bg-primary-700 p-6 text-white shadow-warm transition-colors hover:bg-primary-800"
          >
            <div>
              <h3 className="text-lg font-bold">Inizia a esplorare</h3>
              <p className="text-sm text-primary-100">Sfoglia i negozi e i prodotti di Piacenza.</p>
            </div>
            <ArrowRight size={22} strokeWidth={2.2} className="shrink-0 transition-transform group-hover:translate-x-1" aria-hidden />
          </Link>
          <Link
            href="/sell"
            className="group flex items-center justify-between gap-3 rounded-2xl border border-cream-300 bg-white p-6 text-ink-900 shadow-warm-sm transition-colors hover:border-primary-200"
          >
            <div>
              <h3 className="flex items-center gap-2 text-lg font-bold">
                <Store size={18} strokeWidth={2.2} className="text-primary-600" aria-hidden /> Hai un negozio?
              </h3>
              <p className="text-sm text-ink-600">Vendi su MyCity: vetrina pro, niente canone.</p>
            </div>
            <ArrowRight size={22} strokeWidth={2.2} className="shrink-0 text-primary-600 transition-transform group-hover:translate-x-1" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}

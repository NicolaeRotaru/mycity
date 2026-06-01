import { Store, ShoppingBag, Banknote, ArrowRight, type LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import HomeCtaLink from '@/components/home/HomeCtaLink';

/**
 * Come funziona — 3 step per il nuovo visitatore.
 *
 * Sta subito sotto l'hero: prima di chiedere all'utente di sfogliare, gli
 * spieghiamo il modello (negozi locali + paghi alla consegna + consegna a casa).
 * È la sezione che toglie il freno #1 di chi non conosce il servizio
 * ("come funziona, e quando pago?"). Server component: nessuno stato.
 *
 * NB: il framing su account/registrazione è ONESTO — l'account serve solo
 * alla conferma dell'ordine; carrello e indirizzo si compilano da ospite.
 */

type Step = {
  n: number;
  Icon: LucideIcon;
  color: 'primary' | 'accent' | 'olive';
  title: string;
  desc: string;
};

const STEPS: Step[] = [
  {
    n: 1,
    Icon: Store,
    color: 'primary',
    title: 'Scegli',
    desc: 'Sfoglia i negozi e i prodotti di Piacenza, dai commercianti della tua via.',
  },
  {
    n: 2,
    Icon: ShoppingBag,
    color: 'accent',
    title: 'Ordina',
    desc: 'Aggiungi al carrello e inserisci l’indirizzo. L’account serve solo per confermare l’ordine.',
  },
  {
    n: 3,
    Icon: Banknote,
    color: 'olive',
    title: 'Ricevi e paghi alla consegna',
    desc: 'Te lo portiamo a casa in 24-48h. Paghi al rider quando arriva: zero rischi.',
  },
];

const CIRCLE: Record<Step['color'], string> = {
  primary: 'bg-primary-100 text-primary-700',
  accent: 'bg-accent-100 text-accent-700',
  olive: 'bg-olive-100 text-olive-700',
};

export default function HowItWorks({ className }: { className?: string }) {
  return (
    <section className={className ?? 'container mx-auto px-4 sm:px-6 py-12'}>
      <div className="text-center mb-8">
        <span className="inline-flex items-center gap-1.5 text-primary-700 text-xs font-bold uppercase tracking-wider">
          Semplice e senza pensieri
        </span>
        <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mt-1">
          Come funziona, in 3 passi
        </h2>
      </div>

      <ol className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        {STEPS.map((s) => (
          <li key={s.n}>
            <Card variant="elevated" padding="lg" as="article" className="h-full">
              <div className="flex items-center gap-3 mb-4">
                <span className={`relative shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${CIRCLE[s.color]}`}>
                  <s.Icon size={22} strokeWidth={2.2} />
                  <span className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-ink-900 text-white text-xs font-bold flex items-center justify-center ring-2 ring-white">
                    {s.n}
                  </span>
                </span>
                <h3 className="font-serif font-bold text-ink-900 text-lg leading-tight">{s.title}</h3>
              </div>
              <p className="text-sm text-ink-600 leading-relaxed">{s.desc}</p>
            </Card>
          </li>
        ))}
      </ol>

      <div className="flex justify-center mt-8">
        <HomeCtaLink
          href="/categorie"
          ctaId="howitworks_cta"
          location="how_it_works"
          className="inline-flex items-center gap-2 bg-primary-700 hover:bg-primary-800 text-white px-6 py-3 rounded-full font-semibold transition-colors shadow-warm"
        >
          Inizia a esplorare
          <ArrowRight size={18} strokeWidth={2.2} />
        </HomeCtaLink>
      </div>
    </section>
  );
}

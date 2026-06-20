import Link from 'next/link';
import {
  Briefcase, Store, Bike, Laptop, ArrowRight, MapPin, CalendarClock,
  TrendingUp, HeartHandshake, Clock, Mail,
} from 'lucide-react';

export const metadata = {
  title: 'Lavora con noi · MyCity',
  description: 'Costruiamo il commercio di quartiere del futuro. Porta il tuo negozio, diventa rider o entra nel team MyCity a Piacenza.',
  alternates: { canonical: '/lavora-con-noi' },
  openGraph: {
    title: 'Lavora con noi · MyCity',
    description: 'Costruiamo il commercio di quartiere del futuro. Porta il tuo negozio, diventa rider o entra nel team MyCity.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/lavora-con-noi',
  },
};

const PATHS = [
  {
    Icon: Store,
    title: 'Porta il tuo negozio',
    body: 'Hai un’attività a Piacenza? Vendi online e raggiungi nuovi clienti del quartiere, senza stravolgere il tuo modo di lavorare. Ti seguiamo passo passo.',
    href: '/sell',
    cta: 'Apri un negozio',
  },
  {
    Icon: Bike,
    title: 'Diventa rider',
    body: 'Consegna in bici o scooter nel centro di Piacenza, scegli i tuoi turni e vieni pagato ogni settimana. Tragitti brevi, tutto in città.',
    href: '/sign-up?role=rider',
    cta: 'Candidati come rider',
  },
  {
    Icon: Laptop,
    title: 'Entra nel team',
    body: 'Prodotto, operazioni, supporto ai negozi: cerchiamo persone curiose che vogliono far crescere un servizio utile alla loro città.',
    href: '#posizioni',
    cta: 'Vedi le posizioni',
  },
];

const PERKS = [
  {
    Icon: MapPin,
    title: 'Impatto locale',
    body: 'Quello che fai cambia il quartiere in cui vivi, non una metrica astratta.',
  },
  {
    Icon: CalendarClock,
    title: 'Flessibilità vera',
    body: 'Turni e orari pensati per stare nella vita delle persone, non contro.',
  },
  {
    Icon: TrendingUp,
    title: 'Crescita rapida',
    body: 'Siamo agli inizi: c’è spazio per prendersi responsabilità presto.',
  },
  {
    Icon: HeartHandshake,
    title: 'Squadra vicina',
    body: 'Team piccolo e affiatato, decisioni veloci, zero burocrazia.',
  },
];

const JOBS = [
  {
    title: 'Account negozi (Merchant Success)',
    location: 'Piacenza',
    type: 'Full-time',
    tag: 'Commerciale',
    mailto: 'mailto:lavora@mycity.it?subject=Candidatura%20Account%20negozi',
  },
  {
    title: 'Coordinatore flotta rider',
    location: 'Piacenza',
    type: 'Full-time',
    tag: 'Operazioni',
    mailto: 'mailto:lavora@mycity.it?subject=Candidatura%20Coordinatore%20flotta',
  },
  {
    title: 'Product Designer',
    location: 'Ibrido',
    type: 'Full-time',
    tag: 'Prodotto',
    mailto: 'mailto:lavora@mycity.it?subject=Candidatura%20Product%20Designer',
  },
  {
    title: 'Operatore supporto clienti',
    location: 'Piacenza',
    type: 'Part-time',
    tag: 'Supporto',
    mailto: 'mailto:lavora@mycity.it?subject=Candidatura%20Supporto%20clienti',
  },
];

export default function LavoraConNoiPage() {
  return (
    <div>
      {/* Hero scuro */}
      <header className="bg-gradient-to-br from-ink-900 to-primary-800 text-white">
        <div className="container mx-auto px-6 max-w-5xl pt-16 pb-[70px]">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-label text-accent-300 mb-3.5">
            <Briefcase size={14} strokeWidth={2.4} aria-hidden /> Lavora con noi
          </span>
          <h1 className="font-serif text-4xl md:text-5xl lg:text-[54px] font-extrabold leading-[1.05] mb-4 max-w-[18ch]">
            Costruiamo il commercio di quartiere del futuro.
          </h1>
          <p className="text-lg md:text-xl leading-relaxed text-white/90 max-w-[54ch]">
            MyCity è fatta di negozianti, rider e persone di prodotto che credono in una cosa
            semplice: la città è più viva quando si compra vicino. Scegli da dove vuoi partire.
          </p>
        </div>
      </header>

      <div className="container mx-auto px-6 max-w-5xl">
        {/* Tre percorsi */}
        <section className="py-14">
          <h2 className="font-serif text-3xl md:text-4xl font-extrabold text-ink-900 mb-1.5">
            Tre modi per salire a bordo
          </h2>
          <p className="text-base text-ink-500 mb-7">Ogni percorso ha il suo ritmo. Trova il tuo.</p>
          <div className="grid md:grid-cols-3 gap-4">
            {PATHS.map(({ Icon, title, body, href, cta }) => (
              <div
                key={title}
                className="bg-white border border-cream-300 rounded-2xl p-6 flex flex-col shadow-warm-sm"
              >
                <span className="w-[50px] h-[50px] rounded-lg bg-primary-100 text-primary-700 inline-flex items-center justify-center mb-4">
                  <Icon size={24} strokeWidth={2.2} aria-hidden />
                </span>
                <h3 className="font-serif text-xl font-bold text-ink-900 mb-1.5">{title}</h3>
                <p className="text-sm leading-relaxed text-ink-600 mb-5 flex-1">{body}</p>
                <Link
                  href={href}
                  className="inline-flex items-center gap-1.5 self-start rounded-full bg-primary-700 text-white font-bold text-sm px-4 py-2.5 hover:bg-primary-800 transition-colors"
                >
                  {cta} <ArrowRight size={16} strokeWidth={2.2} aria-hidden />
                </Link>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Cosa offriamo — banda */}
      <section className="bg-cream-100 border-y border-cream-300">
        <div className="container mx-auto px-6 max-w-5xl py-14">
          <h2 className="font-serif text-3xl md:text-4xl font-extrabold text-ink-900 mb-1.5">
            Cosa offriamo
          </h2>
          <p className="text-base text-ink-500 mb-7">Un posto dove il tuo lavoro si vede, in città.</p>
          <div className="grid md:grid-cols-2 gap-4 md:gap-x-10 md:gap-y-4">
            {PERKS.map(({ Icon, title, body }) => (
              <div key={title} className="flex gap-3.5 items-start">
                <span className="w-10 h-10 rounded-md bg-olive-50 text-olive-700 inline-flex items-center justify-center shrink-0">
                  <Icon size={20} strokeWidth={2.2} aria-hidden />
                </span>
                <div>
                  <span className="block text-[15px] font-bold text-ink-900">{title}</span>
                  <span className="block text-sm text-ink-600 mt-0.5 leading-relaxed">{body}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="container mx-auto px-6 max-w-5xl">
        {/* Posizioni aperte */}
        <section id="posizioni" className="py-14 scroll-mt-24">
          <h2 className="font-serif text-3xl md:text-4xl font-extrabold text-ink-900 mb-1.5">
            Posizioni aperte
          </h2>
          <p className="text-base text-ink-500 mb-7">Piacenza · alcune posizioni sono ibride.</p>
          <ul className="flex flex-col gap-3">
            {JOBS.map((job) => (
              <li
                key={job.title}
                className="bg-white border border-cream-300 rounded-xl px-5 py-4 flex items-center gap-4 flex-wrap"
              >
                <div className="flex-1 min-w-[200px]">
                  <h3 className="text-[17px] font-bold text-ink-900 mb-1">{job.title}</h3>
                  <div className="text-[13px] text-ink-500 flex gap-3.5 flex-wrap">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin size={14} strokeWidth={2.2} aria-hidden /> {job.location}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock size={14} strokeWidth={2.2} aria-hidden /> {job.type}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-accent-100 text-accent-800 whitespace-nowrap">
                  {job.tag}
                </span>
                <a
                  href={job.mailto}
                  className="inline-flex items-center gap-1.5 border border-cream-300 text-primary-700 font-bold text-sm px-4 py-2.5 rounded-full hover:bg-cream-50 transition-colors"
                >
                  Candidati <ArrowRight size={16} strokeWidth={2.2} aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* CTA finale */}
        <section className="pb-16">
          <div className="bg-ink-900 text-white rounded-2xl p-8 md:p-11 text-center">
            <h2 className="font-serif text-2xl md:text-3xl font-extrabold text-white mb-2">
              Non trovi il ruolo giusto?
            </h2>
            <p className="text-white/80 text-[15px] max-w-[50ch] mx-auto mb-6">
              Scrivici comunque. Se condividi la nostra idea di città, troveremo il modo di lavorare
              insieme.
            </p>
            <a
              href="mailto:lavora@mycity.it?subject=Candidatura%20spontanea"
              className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 font-bold text-[15px] bg-accent-500 text-ink-900 hover:bg-accent-400 transition-colors"
            >
              <Mail size={18} strokeWidth={2.2} aria-hidden /> Invia una candidatura spontanea
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

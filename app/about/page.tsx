import Link from 'next/link';
import {
  Sparkles, MapPin, Handshake, Banknote, Briefcase, Store, ArrowRight,
} from 'lucide-react';
import { loadPublishedCmsPage } from '@/lib/cms';
import CmsPageView from '@/components/cms/CmsPageView';
import { getServerSupabase } from '@/lib/supabase/server';

export const metadata = {
  title: 'Chi siamo · MyCity',
  description: 'MyCity è il marketplace dei negozi locali. Compra dai commercianti della tua città, ricevi a casa in 24-48h.',
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'Chi siamo · MyCity',
    description: 'Il marketplace dei negozi locali di Piacenza. Compra dai commercianti della tua città.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/about',
  },
};

// Copy marketing statica della pagina chi-siamo. Una metrica ("negozi attivi")
// viene resa LIVE da una count query (vedi buildStats); le altre restano claim.
const STATS = [
  { value: '24-48h', label: 'tempi di consegna' },
  { value: '100%', label: 'venditori locali verificati' },
  { value: '0€', label: 'commissioni mensili per i negozi' },
  { value: 'Pay-on-delivery', label: 'paghi alla consegna, anche in contanti' },
];

/**
 * Conteggio REALE per la riga stat (nessuno schema nuovo): negozi attivi =
 * profili venditore approvati, via una count query (head: true, niente payload).
 * Le "zone" NON sono derivabili in modo affidabile (profiles ha solo
 * `store_address` free-text, nessuna colonna città/provincia) → non vengono
 * fabbricate. Se la query fallisce o ritorna 0, si tiene la copy statica come
 * fallback (nessuna regressione, nessun "0" finto in pagina).
 */
async function buildStats(): Promise<typeof STATS> {
  try {
    const supa = await getServerSupabase();
    const { count: storeCount } = await supa
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'seller')
      .eq('is_approved', true);

    const stats = [...STATS];
    if (typeof storeCount === 'number' && storeCount > 0) {
      // Sostituisce il claim "100%" col numero reale di negozi attivi.
      stats[1] = { value: `${storeCount}`, label: storeCount === 1 ? 'negozio locale attivo' : 'negozi locali attivi' };
    }
    return stats;
  } catch {
    return STATS; // fallback: copy statica
  }
}

const VALUES = [
  {
    Icon: MapPin,
    title: 'Locale, davvero',
    body: 'Solo commercianti del territorio, verificati uno a uno. Niente rivenditori anonimi: dietro ogni prodotto c’è una persona che conosci.',
  },
  {
    Icon: Handshake,
    title: 'Equi con i negozi',
    body: 'Commissioni trasparenti e incassi rapidi. Il valore resta in città, nelle tasche di chi lo crea.',
  },
  {
    Icon: Banknote,
    title: 'Semplice per tutti',
    body: 'Paghi alla consegna, in contanti se vuoi. Nessun account obbligatorio per iniziare: la tecnologia sparisce, resta il servizio.',
  },
];

export default async function AboutPage() {
  // Se l'admin ha pubblicato una versione a blocchi di questa pagina, usala;
  // altrimenti resta il contenuto predefinito qui sotto (nessuna regressione).
  const cms = await loadPublishedCmsPage('about');
  if (cms) return <CmsPageView page={cms} />;

  const stats = await buildStats();

  return (
    <div>
      {/* Hero gradient */}
      <header className="bg-gradient-to-br from-primary-700 to-secondary-700 text-white">
        <div className="container mx-auto px-6 max-w-5xl pt-16 pb-20">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-label text-accent-300 mb-3.5">
            <Sparkles size={14} strokeWidth={2.4} aria-hidden /> La nostra storia
          </span>
          <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.05] mb-4 max-w-[16ch]">
            Il quartiere, a portata di mano.
          </h1>
          <p className="text-lg md:text-xl leading-relaxed text-white/90 max-w-[52ch]">
            MyCity nasce a Piacenza per dare ai negozi di vicinato lo stesso superpotere dei grandi
            e-commerce: vendere online e consegnare a casa, restando ciò che sono — la salumeria
            di fiducia, il fornaio sotto casa, l’enoteca all’angolo.
          </p>
        </div>
      </header>

      {/* Stats row, overlapping the hero */}
      <div className="container mx-auto px-6 max-w-5xl -mt-10 relative z-10">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="bg-white border border-cream-300 rounded-xl px-5 py-5 shadow-warm"
            >
              <div className="font-serif text-2xl md:text-3xl font-extrabold text-primary-700 leading-none">
                {s.value}
              </div>
              <div className="text-sm text-ink-500 mt-1.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="container mx-auto px-6 max-w-5xl">
        {/* Perché esistiamo */}
        <section className="py-14 md:py-16 grid md:grid-cols-[1.1fr_1fr] gap-10 md:gap-12 items-center">
          <div>
            <h2 className="font-serif text-3xl md:text-4xl font-extrabold text-ink-900 mb-4">
              Perché esistiamo
            </h2>
            <p className="text-[17px] leading-relaxed text-ink-700 max-w-[64ch]">
              Ogni saracinesca che si abbassa è una storia, un mestiere, un pezzo di città che si
              spegne. Le grandi piattaforme hanno reso comodo comprare lontano; noi vogliamo rendere
              altrettanto comodo comprare <strong>vicino</strong>.
            </p>
            <p className="text-[17px] leading-relaxed text-ink-700 max-w-[64ch] mt-3.5">
              Con MyCity un negoziante pubblica i suoi prodotti in pochi minuti — anche da una foto
              — e i suoi clienti li ricevono a casa in giornata. Niente vetrine digitali complicate,
              niente commissioni assurde: solo il quartiere che torna a girare.
            </p>
          </div>
          <div
            className="rounded-2xl aspect-[4/3] bg-gradient-to-br from-cream-200 via-cream-100 to-primary-100 border border-cream-300 shadow-card flex items-center justify-center"
            aria-hidden
          >
            <Store size={64} strokeWidth={1.4} className="text-primary-400/70" />
          </div>
        </section>
      </div>

      {/* I nostri valori — banda */}
      <section className="bg-cream-100 border-y border-cream-300">
        <div className="container mx-auto px-6 max-w-5xl py-14 md:py-16">
          <h2 className="font-serif text-3xl md:text-4xl font-extrabold text-ink-900 mb-3">
            I nostri valori
          </h2>
          <p className="text-[17px] leading-relaxed text-ink-700 max-w-[64ch]">
            Tre principi guidano ogni decisione di prodotto.
          </p>
          <div className="grid md:grid-cols-3 gap-4 mt-6">
            {VALUES.map(({ Icon, title, body }) => (
              <div key={title} className="bg-white border border-cream-300 rounded-xl p-6">
                <span className="w-12 h-12 rounded-lg bg-primary-100 text-primary-700 inline-flex items-center justify-center mb-3.5">
                  <Icon size={22} strokeWidth={2.2} aria-hidden />
                </span>
                <h3 className="text-lg font-bold text-ink-900 mb-1.5">{title}</h3>
                <p className="text-sm leading-relaxed text-ink-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="container mx-auto px-6 max-w-5xl">
        {/* Come siamo arrivati qui */}
        <section className="py-14 md:py-16 grid md:grid-cols-[1fr_1.1fr] gap-10 md:gap-12 items-center">
          <div
            className="order-2 md:order-1 rounded-2xl aspect-[4/3] bg-gradient-to-br from-secondary-100 via-cream-100 to-accent-100 border border-cream-300 shadow-card flex items-center justify-center"
            aria-hidden
          >
            <MapPin size={64} strokeWidth={1.4} className="text-secondary-500/70" />
          </div>
          <div className="order-1 md:order-2">
            <h2 className="font-serif text-3xl md:text-4xl font-extrabold text-ink-900 mb-4">
              Come siamo arrivati qui
            </h2>
            <p className="text-[17px] leading-relaxed text-ink-700 max-w-[64ch]">
              Tutto è partito da una domanda semplice di un gruppo di piacentini: <em>perché posso
              farmi arrivare qualsiasi cosa dall’altra parte del mondo, ma non un etto di coppa dal
              salumiere di fronte?</em>
            </p>
            <p className="text-[17px] leading-relaxed text-ink-700 max-w-[64ch] mt-3.5">
              Abbiamo messo insieme i primi negozi del centro storico, una flotta di rider in bici e
              un’app pensata per chi non ha tempo da perdere. Oggi MyCity cresce quartiere dopo
              quartiere, sempre con la stessa bussola: la prossimità.
            </p>
          </div>
        </section>

        {/* CTA band scura */}
        <section className="pb-16">
          <div className="bg-ink-900 text-white rounded-2xl p-8 md:p-11 flex flex-col md:flex-row md:items-center md:justify-between gap-7">
            <div>
              <h2 className="font-serif text-2xl md:text-3xl font-extrabold text-white mb-2">
                Vuoi farne parte?
              </h2>
              <p className="text-white/80 text-[15px] max-w-[46ch]">
                Che tu abbia un negozio, una bici o voglia di costruire qualcosa di utile per la tua
                città — c’è posto per te.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/lavora-con-noi"
                className="inline-flex items-center gap-2 rounded-full px-5 py-3 font-bold text-[15px] bg-accent-500 text-ink-900 hover:bg-accent-400 transition-colors"
              >
                <Briefcase size={18} strokeWidth={2.2} aria-hidden /> Lavora con noi
              </Link>
              <Link
                href="/sell"
                className="inline-flex items-center gap-2 rounded-full px-5 py-3 font-bold text-[15px] bg-white/10 text-white border border-white/25 hover:bg-white/20 transition-colors"
              >
                <Store size={18} strokeWidth={2.2} aria-hidden /> Apri un negozio
                <ArrowRight size={16} strokeWidth={2.2} aria-hidden />
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

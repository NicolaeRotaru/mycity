import Link from 'next/link';
import { loadPublishedCmsPage } from '@/lib/cms';
import CmsPageView from '@/components/cms/CmsPageView';

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

export default async function AboutPage() {
  // Se l'admin ha pubblicato una versione a blocchi di questa pagina, usala;
  // altrimenti resta il contenuto predefinito qui sotto (nessuna regressione).
  const cms = await loadPublishedCmsPage('about');
  if (cms) return <CmsPageView page={cms} />;

  return (
    <div className="container mx-auto px-6 py-10 max-w-4xl">
      <div className="text-center mb-12">
        <h1 className="text-3xl md:text-5xl font-extrabold text-ink-900 mb-4">
          Il mercato locale della tua città, <span className="bg-gradient-to-r from-primary-600 to-pink-600 bg-clip-text text-transparent">online</span>
        </h1>
        <p className="text-lg text-ink-600 max-w-2xl mx-auto">
          MyCity collega chi vende e chi compra nella stessa città. Ordini online, paghi alla consegna, ricevi a casa in 24-48h.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-12">
        <div className="bg-white border rounded-xl p-6 text-center">
          <div className="text-4xl mb-2">🏘️</div>
          <div className="text-2xl font-extrabold text-primary-700">100%</div>
          <div className="text-sm text-ink-600">Venditori locali</div>
        </div>
        <div className="bg-white border rounded-xl p-6 text-center">
          <div className="text-4xl mb-2">⚡</div>
          <div className="text-2xl font-extrabold text-secondary-600">24-48h</div>
          <div className="text-sm text-ink-600">Consegna</div>
        </div>
        <div className="bg-white border rounded-xl p-6 text-center">
          <div className="text-4xl mb-2">💰</div>
          <div className="text-2xl font-extrabold text-secondary-600">0€</div>
          <div className="text-sm text-ink-600">Commissioni mensili</div>
        </div>
      </div>

      <section className="prose prose-gray max-w-none mb-12">
        <h2 className="text-2xl font-bold text-ink-900 mb-4">La nostra missione</h2>
        <p className="text-ink-700 leading-relaxed mb-4">
          Crediamo che il commercio locale sia il cuore di ogni città. Quando compri sotto casa, sostieni famiglie,
          mantieni vive le strade del centro e riduci l'impatto ambientale delle spedizioni a lunga distanza.
        </p>
        <p className="text-ink-700 leading-relaxed">
          MyCity dà ai negozi di quartiere gli stessi strumenti dei grandi marketplace: vetrina online, gestione ordini,
          consegne con rider, recensioni, pagamenti, statistiche. Senza commissioni mensili e senza vincoli.
        </p>
      </section>

      <section className="mb-12">
        <h2 className="text-2xl font-bold text-ink-900 mb-6">Come funziona</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-primary-50 rounded-xl p-5">
            <div className="text-3xl mb-2">🔎</div>
            <div className="font-bold mb-1">1. Cerchi</div>
            <p className="text-sm text-ink-700">Scopri i negozi vicino a te, leggi recensioni e confronta prezzi.</p>
          </div>
          <div className="bg-secondary-50 rounded-xl p-5">
            <div className="text-3xl mb-2">🛒</div>
            <div className="font-bold mb-1">2. Ordini</div>
            <p className="text-sm text-ink-700">Aggiungi al carrello, scegli consegna o ritiro, conferma. Paghi alla consegna.</p>
          </div>
          <div className="bg-secondary-50 rounded-xl p-5">
            <div className="text-3xl mb-2">📦</div>
            <div className="font-bold mb-1">3. Ricevi</div>
            <p className="text-sm text-ink-700">In 24-48h il rider ti consegna a casa, oppure ritiri in negozio con sconto.</p>
          </div>
        </div>
        <div className="mt-4">
          <Link href="/come-funziona" className="inline-flex items-center gap-1.5 font-semibold text-primary-700 hover:underline">
            Scopri come funziona nel dettaglio <span aria-hidden>→</span>
          </Link>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-2xl font-bold text-ink-900 mb-6">I nostri valori</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex gap-3 bg-white border rounded-xl p-5">
            <div className="text-2xl shrink-0">🤝</div>
            <div>
              <div className="font-bold mb-1">Trasparenza</div>
              <p className="text-sm text-ink-700">Prezzi chiari, commissioni trasparenti, nessuna sorpresa.</p>
            </div>
          </div>
          <div className="flex gap-3 bg-white border rounded-xl p-5">
            <div className="text-2xl shrink-0">🌱</div>
            <div>
              <div className="font-bold mb-1">Sostenibilità</div>
              <p className="text-sm text-ink-700">Consegne brevi, meno emissioni, supporto al territorio.</p>
            </div>
          </div>
          <div className="flex gap-3 bg-white border rounded-xl p-5">
            <div className="text-2xl shrink-0">🔒</div>
            <div>
              <div className="font-bold mb-1">Privacy</div>
              <p className="text-sm text-ink-700">I tuoi dati restano tuoi. Conformità GDPR sin dal primo giorno.</p>
            </div>
          </div>
          <div className="flex gap-3 bg-white border rounded-xl p-5">
            <div className="text-2xl shrink-0">💪</div>
            <div>
              <div className="font-bold mb-1">Comunità</div>
              <p className="text-sm text-ink-700">Ogni acquisto sostiene un negozio reale della tua città.</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid sm:grid-cols-2 gap-4">
        <Link href="/sign-up" className="block bg-gradient-to-br from-primary-600 to-purple-600 text-white rounded-2xl p-6 hover:shadow-lg transition-all">
          <div className="text-3xl mb-2">🛍️</div>
          <h3 className="text-lg font-bold mb-1">Inizia a comprare</h3>
          <p className="text-primary-100 text-sm">Crea un account in 30 secondi.</p>
        </Link>
        <Link href="/sell" className="block bg-gradient-to-br from-pink-600 to-orange-500 text-white rounded-2xl p-6 hover:shadow-lg transition-all">
          <div className="text-3xl mb-2">🏪</div>
          <h3 className="text-lg font-bold mb-1">Diventa venditore</h3>
          <p className="text-secondary-100 text-sm">Vetrina professionale, niente commissioni, approvazione 48h.</p>
        </Link>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Calendar, Mail, BookOpen } from 'lucide-react';

export const metadata = {
  title: 'Resi e rimborsi · MyCity',
  description: 'Politica di reso e rimborso del marketplace MyCity.',
  alternates: { canonical: '/returns' },
  openGraph: {
    title: 'Resi e rimborsi · MyCity',
    description: 'Politica di reso e rimborso del marketplace MyCity.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/returns',
  },
};

export default function ReturnsPage() {
  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      {/* Page header — linguaggio dell'hub account: serif + sottotitolo ink-500 */}
      <header className="mb-8">
        <p className="text-xs font-bold uppercase tracking-[0.05em] text-primary-700">Assistenza</p>
        <h1 className="mt-0.5 font-serif text-3xl font-extrabold leading-tight text-ink-900 sm:text-[32px]">
          Resi e rimborsi
        </h1>
        <p className="mt-1 text-sm text-ink-500">Hai 14 giorni di tempo per ripensarci. Ecco come funziona.</p>
      </header>

      {/* Callout 14 giorni — card cream-bordered */}
      <div className="mb-10 rounded-2xl border border-cream-300 bg-white p-6">
        <div className="flex items-start gap-4">
          <span
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700"
            aria-hidden
          >
            <Calendar size={24} strokeWidth={2.2} />
          </span>
          <div>
            <h2 className="mb-1 font-serif text-lg font-bold text-ink-900">14 giorni di diritto di recesso</h2>
            <p className="text-sm text-ink-700">
              Per legge (D.Lgs. 206/2005 - Codice del Consumo) hai 14 giorni dalla consegna per restituire qualsiasi
              prodotto senza dover fornire una motivazione.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 text-ink-700">
        <section className="rounded-2xl border border-cream-300 bg-white p-6">
          <h2 className="mb-3 font-serif text-xl font-bold text-ink-900">Come restituire un prodotto</h2>
          <ol className="list-decimal space-y-2 pl-5 leading-relaxed">
            <li>Vai su <Link href="/orders" className="font-semibold text-primary-700 hover:text-primary-800">&quot;I miei ordini&quot;</Link> e apri l&apos;ordine interessato.</li>
            <li>Clicca su <strong>&quot;Richiedi reso&quot;</strong> e seleziona i prodotti da restituire.</li>
            <li>Specifica il motivo (cambio idea, taglia errata, prodotto difettoso…) e conferma.</li>
            <li>Il venditore riceve la richiesta e ti indica le modalità di spedizione del reso.</li>
            <li>Spedisci il pacco entro 14 giorni dalla richiesta.</li>
            <li>Al ricevimento, il venditore verifica il prodotto e procede al rimborso.</li>
          </ol>
        </section>

        <section className="rounded-2xl border border-cream-300 bg-white p-6">
          <h2 className="mb-3 font-serif text-xl font-bold text-ink-900">Condizioni del prodotto restituito</h2>
          <p className="mb-2 leading-relaxed">Il prodotto deve essere:</p>
          <ul className="list-disc space-y-1 pl-5 leading-relaxed">
            <li>Integro, non danneggiato e non usato (è ammessa la prova come faresti in negozio).</li>
            <li>Completo di etichette, accessori e confezione originale.</li>
            <li>Non si applica a: prodotti deperibili (alimentari freschi), prodotti igienici sigillati aperti,
            beni personalizzati, contenuti digitali, riviste, biglietti per eventi.</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-cream-300 bg-white p-6">
          <h2 className="mb-3 font-serif text-xl font-bold text-ink-900">Tempi e modalità di rimborso</h2>
          <ul className="list-disc space-y-1 pl-5 leading-relaxed">
            <li>Il rimborso avviene <strong>entro 14 giorni</strong> dalla ricezione del prodotto da parte del venditore.</li>
            <li>Per pagamento alla consegna il rimborso viene effettuato con bonifico sull&apos;IBAN che ci fornisci.</li>
            <li>Per pagamenti con carta il rimborso accredita sulla stessa carta usata per l&apos;acquisto.</li>
            <li>Verrai notificato a ogni stato (richiesta inviata, ricevuta, approvata, rimborsata).</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-cream-300 bg-white p-6">
          <h2 className="mb-3 font-serif text-xl font-bold text-ink-900">Chi paga la spedizione del reso?</h2>
          <ul className="list-disc space-y-1 pl-5 leading-relaxed">
            <li><strong>Cambio idea:</strong> le spese di restituzione sono a tuo carico.</li>
            <li><strong>Prodotto difettoso o non conforme:</strong> il reso è gratuito e organizzato da noi.</li>
            <li><strong>Errore del venditore</strong> (prodotto sbagliato, taglia diversa da quella ordinata): reso gratuito.</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-cream-300 bg-white p-6">
          <h2 className="mb-3 font-serif text-xl font-bold text-ink-900">Garanzia legale di conformità</h2>
          <p className="leading-relaxed">Tutti i prodotti acquistati su MyCity sono coperti dalla garanzia legale di <strong>24 mesi</strong> contro
          i difetti di conformità (art. 128 e seguenti del Codice del Consumo). Per beni usati la garanzia è di 12 mesi.</p>
        </section>

        <section className="rounded-2xl border border-cream-300 bg-white p-6">
          <h2 className="mb-3 font-serif text-xl font-bold text-ink-900">Hai bisogno di aiuto?</h2>
          <p className="leading-relaxed">Se hai dubbi o problemi con un reso, scrivici: il nostro team di supporto media tra te e il venditore
          per risolvere ogni situazione.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button href="/contact"><span className="inline-flex items-center gap-2"><Mail size={18} aria-hidden /> Contatta supporto</span></Button>
            <Link href="/faq" className="inline-flex items-center gap-2 rounded-lg bg-cream-100 px-5 py-2.5 font-semibold text-ink-900 transition-colors hover:bg-cream-200">
              <BookOpen size={18} aria-hidden /> Vai alle FAQ
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

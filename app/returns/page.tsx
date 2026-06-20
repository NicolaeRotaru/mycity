import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Undo2, Calendar, Mail, BookOpen } from 'lucide-react';

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
      <div className="mb-8 text-center">
        <h1 className="text-3xl md:text-4xl font-extrabold text-ink-900 mb-3 flex items-center justify-center gap-2"><Undo2 size={32} className="text-primary-600 shrink-0" aria-hidden /> Resi e rimborsi</h1>
        <p className="text-ink-600">Hai 14 giorni di tempo per ripensarci. Ecco come funziona.</p>
      </div>

      <div className="bg-gradient-to-r from-primary-50 to-secondary-50 border border-primary-200 rounded-2xl p-6 mb-10">
        <div className="flex items-start gap-4">
          <Calendar size={32} className="text-primary-600 shrink-0" aria-hidden />
          <div>
            <h2 className="font-bold text-ink-900 mb-1">14 giorni di diritto di recesso</h2>
            <p className="text-sm text-ink-700">
              Per legge (D.Lgs. 206/2005 - Codice del Consumo) hai 14 giorni dalla consegna per restituire qualsiasi
              prodotto senza dover fornire una motivazione.
            </p>
          </div>
        </div>
      </div>

      <section className="prose prose-gray max-w-none space-y-6 text-ink-700 leading-relaxed">
        <div>
          <h2 className="text-xl font-bold text-ink-900 mb-3">Come restituire un prodotto</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>Vai su <Link href="/orders" className="text-primary-700 underline">"I miei ordini"</Link> e apri l'ordine interessato.</li>
            <li>Clicca su <strong>"Richiedi reso"</strong> e seleziona i prodotti da restituire.</li>
            <li>Specifica il motivo (cambio idea, taglia errata, prodotto difettoso…) e conferma.</li>
            <li>Il venditore riceve la richiesta e ti indica le modalità di spedizione del reso.</li>
            <li>Spedisci il pacco entro 14 giorni dalla richiesta.</li>
            <li>Al ricevimento, il venditore verifica il prodotto e procede al rimborso.</li>
          </ol>
        </div>

        <div>
          <h2 className="text-xl font-bold text-ink-900 mb-2">Condizioni del prodotto restituito</h2>
          <p>Il prodotto deve essere:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Integro, non danneggiato e non usato (è ammessa la prova come faresti in negozio).</li>
            <li>Completo di etichette, accessori e confezione originale.</li>
            <li>Non si applica a: prodotti deperibili (alimentari freschi), prodotti igienici sigillati aperti,
            beni personalizzati, contenuti digitali, riviste, biglietti per eventi.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-bold text-ink-900 mb-2">Tempi e modalità di rimborso</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Il rimborso avviene <strong>entro 14 giorni</strong> dalla ricezione del prodotto da parte del venditore.</li>
            <li>Per pagamento alla consegna il rimborso viene effettuato con bonifico sull'IBAN che ci fornisci.</li>
            <li>Per pagamenti con carta il rimborso accredita sulla stessa carta usata per l'acquisto.</li>
            <li>Verrai notificato a ogni stato (richiesta inviata, ricevuta, approvata, rimborsata).</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-bold text-ink-900 mb-2">Chi paga la spedizione del reso?</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Cambio idea:</strong> le spese di restituzione sono a tuo carico.</li>
            <li><strong>Prodotto difettoso o non conforme:</strong> il reso è gratuito e organizzato da noi.</li>
            <li><strong>Errore del venditore</strong> (prodotto sbagliato, taglia diversa da quella ordinata): reso gratuito.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-bold text-ink-900 mb-2">Garanzia legale di conformità</h2>
          <p>Tutti i prodotti acquistati su MyCity sono coperti dalla garanzia legale di <strong>24 mesi</strong> contro
          i difetti di conformità (art. 128 e seguenti del Codice del Consumo). Per beni usati la garanzia è di 12 mesi.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold text-ink-900 mb-2">Hai bisogno di aiuto?</h2>
          <p>Se hai dubbi o problemi con un reso, scrivici: il nostro team di supporto media tra te e il venditore
          per risolvere ogni situazione.</p>
          <div className="flex gap-3 flex-wrap mt-3">
            <Button href="/contact"><span className="inline-flex items-center gap-2"><Mail size={18} aria-hidden /> Contatta supporto</span></Button>
            <Link href="/faq" className="inline-flex items-center gap-2 bg-cream-100 hover:bg-cream-200 text-ink-900 px-5 py-2.5 rounded-lg font-semibold transition-colors">
              <BookOpen size={18} aria-hidden /> Vai alle FAQ
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

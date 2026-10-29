import Link from 'next/link';
import { Truck, Banknote, MapPin, Zap, Store, Clock, ChefHat, Package, Bike, CheckCircle2 } from 'lucide-react';
// Le promesse pubbliche nascono da chi le mantiene, non da un testo scritto qui: il ritiro in
// negozio e' spento nel checkout e nelle due rotte, i minuti della veloce e le sue condizioni hanno una
// casa in lib/promessa-consegna, e il costo e il confine della consegna sono quelli della cassa.
//
// 27/10/2026 — QUESTA PAGINA AVEVA UNA TABELLA SUA. Scriveva a mano 2,50 · 3,50 · 4,50 € per
// fascia di distanza, «GRATIS» sopra i 30 €, «oltre 10 km a preventivo» ed «entro 15 km». La cassa
// faceva un altro conto (2,50 € più 1,20 € al km, più 3 € di consegna) e oggi ne fa un altro
// ancora: si paga solo la consegna, per negozio, e si consegna fino a RAGGIO_CONSEGNA_KM. Qui non
// si scrivono piu' cifre: le danno `riquadroTariffaConsegna()`, `fraseTariffaConsegna()` e la costante del confine, e una prova
// trasforma la pagina in HTML e confronta ogni euro e ogni chilometro col conto della cassa
// (tests/unit/al-lancio-si-paga-solo-la-consegna.test.tsx).
import { NEGOZIO_CHIUSO_COSA_SUCCEDE, fraseTariffaConsegna, riquadroRitiroInNegozio, riquadroTariffaConsegna } from '@/lib/promesse-pubbliche';
import { QUANDO_SI_PUO_LA_VELOCE, VELOCE_IN_MINUTI } from '@/lib/promessa-consegna';
import { RAGGIO_CONSEGNA_KM } from '@/lib/constants';

export const metadata = {
  title: 'Spedizioni e consegne · MyCity',
  description: 'Tempi, costi e modalità di consegna su MyCity.',
  alternates: { canonical: '/shipping' },
  openGraph: {
    title: 'Spedizioni e consegne · MyCity',
    description: 'Tempi, costi e modalità di consegna dei negozi di Piacenza su MyCity.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/shipping',
  },
};

export default function ShippingPage() {
  // 29/10/2026 — Il riquadro scriveva «Consegna 3,00 € · qualunque sia la spesa» sopra una cassa che
  // sotto i 10 € addebita 4 €: titolo, riga sotto e il «si paga o no» del paragrafo vengono dallo stesso conto.
  const tariffa = riquadroTariffaConsegna();
  const confine = `${RAGGIO_CONSEGNA_KM} km`;
  // 29/10/2026 — Era «Consegna in …» e «Consegniamo in … minuti: è la nostra promessa», come cosa
  // certa. La normale arriva nella fascia scelta in cassa; la veloce si può solo alle sue condizioni.
  const titoloVeloce = VELOCE_IN_MINUTI.charAt(0).toUpperCase() + VELOCE_IN_MINUTI.slice(1);

  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      <div className="mb-8 text-center">
        <h1 className="text-3xl md:text-4xl font-extrabold text-ink-900 mb-3 flex items-center justify-center gap-2"><Truck size={32} className="text-primary-600 shrink-0" aria-hidden /> Spedizioni e consegne</h1>
        <p className="text-ink-600">Tempi, costi e opzioni per ricevere il tuo ordine.</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-10">
        <div className="bg-olive-50 border border-olive-200 rounded-xl p-5 text-center">
          <div className="mb-2 flex justify-center"><Banknote size={28} className="text-olive-600" aria-hidden /></div>
          <div className="font-bold text-olive-900">{tariffa.titolo}</div>
          <div className="text-sm text-olive-700 mt-1">{tariffa.sottotitolo}</div>
        </div>
        <div className="bg-primary-50 border border-primary-200 rounded-xl p-5 text-center">
          <div className="mb-2 flex justify-center"><Zap size={28} className="text-primary-600" aria-hidden /></div>
          <div className="font-bold text-primary-900">{titoloVeloce}</div>
          <div className="text-sm text-primary-800 mt-1">{QUANDO_SI_PUO_LA_VELOCE}</div>
        </div>
        <div className="bg-cream-50 border border-cream-300 rounded-xl p-5 text-center">
          <div className="mb-2 flex justify-center"><MapPin size={28} className="text-ink-600" aria-hidden /></div>
          <div className="font-bold text-ink-900">{`Fino a ${confine}`}</div>
          <div className="text-sm text-ink-600 mt-1">dal negozio, in linea d&apos;aria</div>
        </div>
        {riquadroRitiroInNegozio() && (
          <div className="bg-secondary-50 border border-secondary-200 rounded-xl p-5 text-center">
            <div className="mb-2 flex justify-center"><Store size={28} className="text-secondary-600" aria-hidden /></div>
            <div className="font-bold text-secondary-900">{riquadroRitiroInNegozio()!.titolo}</div>
            <div className="text-sm text-secondary-700 mt-1">{riquadroRitiroInNegozio()!.sottotitolo}</div>
          </div>
        )}
      </div>

      {/* Niente classi `prose`: il plugin @tailwindcss/typography non e' installato, quindi
          non facevano niente. La spaziatura dentro i blocchi e' scritta qui, esplicita. */}
      <section className="max-w-none space-y-8 text-ink-700 leading-relaxed">
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-ink-900 mb-2">Tempi di consegna</h2>
          <p>La consegna arriva nella <strong>fascia oraria che scegli in cassa</strong>. Se ti serve prima,
          c&apos;è la consegna <strong>{VELOCE_IN_MINUTI}</strong> dalla conferma del negozio: si può{' '}
          {QUANDO_SI_PUO_LA_VELOCE}. Quando non si può, la cassa non te la propone.</p>
          <ul className="list-disc pl-5">
            <li>I minuti della veloce partono da quando il negozio conferma l’ordine, non da quando lo invii</li>
            <li>Vale negli orari di apertura del negozio che hai scelto</li>
            <li>{NEGOZIO_CHIUSO_COSA_SUCCEDE}</li>
          </ul>
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-bold text-ink-900 mb-2">Quanto costa la consegna</h2>
          {tariffa.siPaga ? (
            <p>Paghi solo la consegna, per ogni negozio da cui ordini: <strong>{fraseTariffaConsegna()}</strong>.
            Non c&apos;è un costo a chilometro.</p>
          ) : (
            <p>La consegna non si paga, qualunque sia la spesa.</p>
          )}
          <ul className="list-disc pl-5">
            <li>Se ordini da due negozi paghi due consegne: ogni negozio ti porta la sua spesa.</li>
            <li>Il totale lo vedi sempre in cassa, prima di confermare l’ordine.</li>
          </ul>
        </div>

        {riquadroRitiroInNegozio() && (
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-ink-900 mb-2">Ritiro in negozio</h2>
            <p>Scegliendo il ritiro in negozio non paghi la consegna. Riceverai una notifica
            appena l&apos;ordine sarà pronto.</p>
          </div>
        )}

        <div className="space-y-3">
          <h2 className="text-xl font-bold text-ink-900 mb-2">Tracciamento</h2>
          <p>Da <Link href="/orders" className="text-primary-700 underline">"I miei ordini"</Link> vedi in tempo reale:</p>
          <ul className="space-y-1 list-none pl-0">
            <li className="flex items-center gap-2"><Clock size={18} className="text-ink-500 shrink-0" aria-hidden /> In attesa di conferma</li>
            <li className="flex items-center gap-2"><ChefHat size={18} className="text-ink-500 shrink-0" aria-hidden /> In preparazione presso il venditore</li>
            <li className="flex items-center gap-2"><Package size={18} className="text-ink-500 shrink-0" aria-hidden /> Pronto per il ritiro / la consegna</li>
            <li className="flex items-center gap-2"><Bike size={18} className="text-ink-500 shrink-0" aria-hidden /> In consegna (con nome del rider)</li>
            <li className="flex items-center gap-2"><CheckCircle2 size={18} className="text-olive-600 shrink-0" aria-hidden /> Consegnato</li>
          </ul>
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-bold text-ink-900 mb-2">Aree servite</h2>
          {/* 28/10/2026 — Qui c'era «Piacenza e dintorni»: col confine a 5 km Podenzano, Rottofreno e
              Gossolengo restano fuori, e la frase li prometteva. Il limite vero è la distanza dal
              negozio. */}
          <p>Consegniamo a <strong>Piacenza</strong>, fino a <strong>{confine}</strong> dal negozio in linea
          d&apos;aria. Quando scrivi il tuo indirizzo, in cassa misuriamo la distanza e ti diciamo subito se ci
          arriviamo. Se l&apos;indirizzo non si trova sulla mappa, la cassa non riesce a misurarla e
          l&apos;ordine passa senza questo controllo.</p>
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-bold text-ink-900 mb-2">Problemi con la consegna?</h2>
          {/* 27/10/2026 — Qui c'era «contatta il nostro supporto entro 48h»: letto come una scadenza,
              limita diritti che la legge non fa scadere (garanzia di conformità di 24 mesi, rischio
              del pacco non arrivato a carico del venditore). Nessun termine inventato. */}
          <p>Se la consegna è in ritardo, il pacco è danneggiato o non è arrivato, scrivici appena puoi:
          <Link href="/contact" className="text-primary-700 underline ml-1">vai ai contatti</Link>.
          Per i difetti dei prodotti vale comunque la garanzia legale di 24 mesi.</p>
        </div>
      </section>
    </div>
  );
}

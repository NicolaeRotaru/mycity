'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShoppingCart, Truck, CreditCard, Undo2, Settings, Store, Bike, Mail, type LucideIcon } from 'lucide-react';

type QA = { q: string; a: React.ReactNode };
type Section = { title: string; icon: LucideIcon; items: QA[] };

const SECTIONS: Section[] = [
  {
    title: 'Acquisti e ordini',
    icon: ShoppingCart,
    items: [
      {
        q: 'Come faccio a ordinare su MyCity?',
        a: 'Cerca un prodotto o un negozio, aggiungilo al carrello, scegli un indirizzo di consegna o il ritiro in negozio e conferma. Riceverai una notifica per ogni cambio di stato dell\'ordine.',
      },
      {
        q: 'Posso comprare da più negozi nello stesso ordine?',
        a: 'Sì. Il carrello supporta più venditori: alla conferma viene creato un ordine separato per ciascun negozio, ognuno con la propria spedizione e gestione.',
      },
      {
        q: 'Posso annullare un ordine?',
        a: 'Sì, finché il venditore non l\'ha preso in carico. Vai su “I miei ordini”, apri l\'ordine e clicca su “Annulla”.',
      },
    ],
  },
  {
    title: 'Spedizioni e consegne',
    icon: Truck,
    items: [
      {
        q: 'Quanto costa la spedizione?',
        a: 'La spedizione è GRATUITA per ordini sopra €30 dallo stesso venditore. Sotto soglia il costo varia in base alla distanza dal negozio (in media €2,50–4,50). Vedi tutti i dettagli nella pagina Spedizioni.',
      },
      {
        q: 'In quanto tempo arriva l\'ordine?',
        a: 'Le consegne avvengono in 24-48h nei comuni serviti. Per ordini effettuati prima delle 12, molti venditori consegnano in giornata.',
      },
      {
        q: 'Posso ritirare in negozio?',
        a: 'Sì, e ottieni il 10% di sconto. Seleziona "Ritiro in negozio" al checkout: ti avviseremo appena l\'ordine sarà pronto.',
      },
      {
        q: 'Posso seguire la mia consegna?',
        a: 'Sì. Dalla sezione "I miei ordini" vedi lo stato in tempo reale: in preparazione, pronto, in consegna, consegnato.',
      },
    ],
  },
  {
    title: 'Pagamenti',
    icon: CreditCard,
    items: [
      {
        q: 'Quali metodi di pagamento accettate?',
        a: 'Attualmente è disponibile il pagamento alla consegna (contanti o POS al rider). Stiamo integrando carte, PayPal e Apple/Google Pay.',
      },
      {
        q: 'Il pagamento è sicuro?',
        a: 'Sì. Tutti i dati transitano cifrati (HTTPS/TLS). Non memorizziamo dati bancari sui nostri server.',
      },
      {
        q: 'Posso usare un codice sconto?',
        a: 'Sì: inserisci il codice nella sezione "Coupon" al checkout. Lo sconto viene applicato prima della conferma.',
      },
    ],
  },
  {
    title: 'Resi e rimborsi',
    icon: Undo2,
    items: [
      {
        q: 'Posso restituire un prodotto?',
        a: 'Hai 14 giorni dalla consegna per esercitare il diritto di recesso. Vai su "I miei ordini" → apri l\'ordine → "Richiedi reso".',
      },
      {
        q: 'In quanto tempo ricevo il rimborso?',
        a: 'Entro 14 giorni dalla ricezione del prodotto da parte del venditore. Per pagamenti alla consegna il rimborso avviene su IBAN.',
      },
      {
        q: 'Chi paga la spedizione del reso?',
        a: 'Le spese di reso sono normalmente a carico dell\'acquirente, salvo prodotto difettoso o errore del venditore.',
      },
    ],
  },
  {
    title: 'Account e impostazioni',
    icon: Settings,
    items: [
      {
        q: 'Come modifico i miei dati?',
        a: <>Da <Link href="/profile" className="text-primary-700 underline">Il tuo account</Link> puoi aggiornare nome, telefono, indirizzo. Da <Link href="/profile/settings" className="text-primary-700 underline">Impostazioni</Link> cambi password e preferenze notifiche.</>,
      },
      {
        q: 'Come elimino il mio account?',
        a: <>Vai su <Link href="/profile/settings" className="text-primary-700 underline">Impostazioni → Elimina account</Link>. La cancellazione è permanente e rimuove tutti i tuoi dati.</>,
      },
      {
        q: 'Ho dimenticato la password',
        a: <>Vai sulla pagina <Link href="/sign-in" className="text-primary-700 underline">Accedi</Link> e clicca su "Password dimenticata?" per riceverla via email.</>,
      },
    ],
  },
  {
    title: 'Vendere su MyCity',
    icon: Store,
    items: [
      {
        q: 'Come divento venditore?',
        a: <>Registra il tuo negozio in 5 minuti dalla pagina <Link href="/sell" className="text-primary-700 underline">Vendi su MyCity</Link>. Serve P.IVA attiva.</>,
      },
      {
        q: 'Quanto costa vendere?',
        a: 'Zero commissioni mensili. Si paga solo una piccola commissione sulle vendite effettivamente concluse.',
      },
      {
        q: 'Come gestisco i miei ordini?',
        a: 'Dalla dashboard venditore vedi prodotti, ordini ricevuti, clienti, statistiche. Tutto in tempo reale.',
      },
    ],
  },
  {
    title: 'Diventare rider',
    icon: Bike,
    items: [
      {
        q: 'Come faccio a consegnare per MyCity?',
        a: 'Contattaci da questa pagina di FAQ via email: info@mycity.it con oggetto "Candidatura Rider". Ti contatteremo entro 48h.',
      },
      {
        q: 'Quanto guadagna un rider?',
        a: 'Il compenso è calcolato per consegna in base alla distanza. Vedi guadagni in tempo reale dalla dashboard rider.',
      },
    ],
  },
];

export default function FaqPage() {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const toggle = (key: string) => setOpen((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div className="container mx-auto px-6 py-10 max-w-4xl">
      <div className="text-center mb-10">
        <h1 className="text-3xl md:text-4xl font-extrabold text-ink-900 mb-3">Domande frequenti</h1>
        <p className="text-ink-600">Tutto quello che devi sapere su MyCity. Non trovi la risposta? <Link href="/contact" className="text-primary-700 underline">Scrivici</Link>.</p>
      </div>

      <div className="space-y-8">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
          <section key={section.title}>
            <h2 className="text-xl font-bold text-ink-900 mb-4 flex items-center gap-2">
              <Icon size={24} className="text-primary-600 shrink-0" aria-hidden /> {section.title}
            </h2>
            <div className="space-y-2">
              {section.items.map((item, i) => {
                const key = `${section.title}-${i}`;
                const isOpen = !!open[key];
                return (
                  <div key={key} className="bg-white border border-cream-300 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-cream-50 transition-colors"
                    >
                      <span className="font-semibold text-ink-900">{item.q}</span>
                      <span className={`text-ink-400 text-xl transition-transform ${isOpen ? 'rotate-45' : ''}`}>+</span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 text-sm text-ink-700 leading-relaxed border-t border-cream-200 pt-3">
                        {item.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          );
        })}
      </div>

      <div className="mt-12 bg-gradient-to-r from-primary-600 to-secondary-600 text-white rounded-2xl p-8 text-center">
        <h3 className="text-xl font-bold mb-2">Non hai trovato la risposta?</h3>
        <p className="text-primary-100 mb-4">Il nostro team risponde entro 24 ore lavorative.</p>
        <Link href="/contact" className="inline-flex items-center gap-2 bg-white text-primary-800 px-6 py-3 rounded-lg font-bold hover:bg-primary-50 transition-colors">
          <Mail size={18} aria-hidden /> Contattaci
        </Link>
      </div>
    </div>
  );
}

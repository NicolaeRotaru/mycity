import Link from 'next/link';

export const metadata = {
  title: 'Centro venditori · MyCity',
};

const TOPICS = [
  {
    icon: '📦',
    title: 'Gestione ordini',
    items: [
      { q: 'Come accetto un ordine?',
        a: 'Da "Ordini ricevuti" clicca sull\'ordine "Nuovo" e premi "Accetta". Riceverai una notifica quando un rider lo prenderà in carico.' },
      { q: 'Posso rifiutare un ordine?',
        a: 'Sì, se non puoi evaderlo. Fornisci sempre un motivo (es. prodotto esaurito). Il cliente riceve rimborso automatico.' },
      { q: 'Come segnalo l\'ordine pronto?',
        a: 'Dalla pagina dell\'ordine premi "Pronto per la consegna". Verrà notificato il primo rider disponibile in zona.' },
    ],
  },
  {
    icon: '🛍️',
    title: 'Prodotti e foto',
    items: [
      { q: 'Quante foto per prodotto?',
        a: 'Da 3 a 5 foto sono l\'ideale. La prima è la copertina: scegli la più chiara e luminosa.' },
      { q: 'Posso aggiornare prezzo o disponibilità?',
        a: 'Sì, da "I miei prodotti" → menu del prodotto → "Modifica" o switch "Disponibile/Esaurito".' },
      { q: 'Come uso l\'AI per compilare la scheda?',
        a: 'Quando crei un prodotto, carica la foto: l\'assistente AI estrae nome, descrizione e categoria. Tu controlli e correggi.' },
    ],
  },
  {
    icon: '💶',
    title: 'Guadagni e pagamenti',
    items: [
      { q: 'Quando ricevo i soldi delle vendite?',
        a: 'Bonifico mensile il giorno 5 sull\'IBAN che hai registrato in Impostazioni. Da "Guadagni" vedi il prossimo importo previsto.' },
      { q: 'Quanto tratteniamo?',
        a: 'L\'8% sul venduto effettivamente concluso. Nessun costo mensile o di iscrizione.' },
      { q: 'Cosa succede se un ordine viene rimborsato?',
        a: 'Non viene calcolato nel netto. Se è già stato pagato, viene compensato sul payout successivo.' },
    ],
  },
  {
    icon: '⭐',
    title: 'Recensioni e clienti',
    items: [
      { q: 'Posso rispondere alle recensioni?',
        a: 'Sì, da "Recensioni" → "Rispondi". Una risposta pubblica ben fatta migliora la fiducia del 30%.' },
      { q: 'Vedo i dati dei clienti?',
        a: 'Solo nome e indirizzo per la consegna. Telefono ed email restano privati per GDPR.' },
      { q: 'Come gestisco un cliente VIP?',
        a: 'Da "I miei clienti" filtra per "VIP (5+ ordini)". Considera un piccolo omaggio o sconto dedicato.' },
    ],
  },
  {
    icon: '🚀',
    title: 'Vendere di più',
    items: [
      { q: 'Cosa rende un negozio attraente?',
        a: 'Logo + copertina + 10+ prodotti con foto pulite e descrizioni complete (peso, materiali, provenienza).' },
      { q: 'Conviene partecipare ai gruppi d\'acquisto?',
        a: 'Sì per prodotti con buon margine: sconti dal 10-30% portano traffico massiccio in giornate specifiche.' },
      { q: 'Come miglioro il posizionamento?',
        a: 'Rispondi velocemente agli ordini, mantieni rating alto, pubblica regolarmente. L\'algoritmo premia i negozi attivi.' },
    ],
  },
];

export default function SellerHelpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900">💡 Centro venditori</h1>
        <p className="text-sm text-gray-500">Guide e risposte rapide per gestire il tuo negozio al meglio.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <Link href="/contact" className="bg-gradient-to-br from-indigo-600 to-purple-600 text-white rounded-xl p-5 hover:shadow-lg transition-all">
          <div className="text-2xl mb-2">✉️</div>
          <p className="font-bold">Contatta il team</p>
          <p className="text-xs text-indigo-100 mt-1">Risposta entro 24h</p>
        </Link>
        <a href="mailto:venditori@mycity.it" className="bg-white border rounded-xl p-5 hover:shadow-md hover:border-indigo-300 transition-all">
          <div className="text-2xl mb-2">📧</div>
          <p className="font-bold text-gray-900">Email dedicata</p>
          <p className="text-xs text-gray-500 mt-1">venditori@mycity.it</p>
        </a>
        <a href="https://wa.me/393000000000" target="_blank" rel="noopener noreferrer" className="bg-white border rounded-xl p-5 hover:shadow-md hover:border-green-300 transition-all">
          <div className="text-2xl mb-2">💬</div>
          <p className="font-bold text-gray-900">WhatsApp</p>
          <p className="text-xs text-gray-500 mt-1">Lun-Ven 9-18</p>
        </a>
      </div>

      <div className="space-y-6">
        {TOPICS.map((topic) => (
          <section key={topic.title} className="bg-white border rounded-xl p-5">
            <h2 className="font-bold text-gray-900 mb-3 flex items-center gap-2 text-lg">
              <span className="text-2xl">{topic.icon}</span> {topic.title}
            </h2>
            <div className="space-y-3">
              {topic.items.map((it) => (
                <details key={it.q} className="group">
                  <summary className="cursor-pointer font-semibold text-gray-800 hover:text-indigo-600 list-none flex items-start justify-between gap-2">
                    <span>{it.q}</span>
                    <span className="text-gray-400 group-open:rotate-45 transition-transform text-xl leading-none">+</span>
                  </summary>
                  <p className="text-sm text-gray-600 mt-2 leading-relaxed pl-1">{it.a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-900">
        <p className="font-bold mb-1">📚 Guide approfondite (prossimamente)</p>
        <p>Stiamo preparando una academy con video tutorial per ogni funzionalità. Iscriviti alla newsletter per essere avvisato.</p>
      </div>
    </div>
  );
}

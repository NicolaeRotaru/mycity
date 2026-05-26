import Link from 'next/link';

export const metadata = {
  title: 'Centro rider · MyCity',
};

const TOPICS = [
  {
    icon: '🚦',
    title: 'Inizio turno',
    items: [
      { q: 'Come ricevo le prime consegne?',
        a: 'Vai online dalla pagina "Disponibilità" 🟢. Quando un ordine è pronto in zona riceverai una notifica push.' },
      { q: 'Posso scegliere le consegne?',
        a: 'Sì. Dalla dashboard rider clicchi "Accetta" sulle consegne disponibili. Nessuna penalità se rifiuti.' },
      { q: 'Quante consegne posso fare in parallelo?',
        a: 'Una alla volta. Quando hai consegnato, vedi subito la prossima disponibile.' },
    ],
  },
  {
    icon: '📍',
    title: 'Durante la consegna',
    items: [
      { q: 'Come trovo il negozio e il cliente?',
        a: 'Dentro la consegna apri la mappa: vedi entrambi i punti. Premi "Naviga" per aprire Google Maps o Apple Maps.' },
      { q: 'Cosa faccio se nessuno risponde alla consegna?',
        a: 'Aspetta 5 min, chiama il cliente dal pulsante "Contatta" e attiva un report dal pulsante "Problema". L\'ordine viene gestito dal supporto.' },
      { q: 'Posso chiedere mancia?',
        a: 'No, è vietato. La piattaforma garantisce un compenso fisso per consegna. I clienti possono apprezzarti con una recensione.' },
    ],
  },
  {
    icon: '💶',
    title: 'Guadagni e bonifici',
    items: [
      { q: 'Quando vengo pagato?',
        a: 'Bonifico mensile il giorno 5 sull\'IBAN inserito in Impostazioni. Vedi sempre il prossimo importo previsto in "Guadagni".' },
      { q: 'Come è calcolato il compenso?',
        a: 'Base fissa + km percorsi. Più la zona è densa, più consegne fai per ora.' },
      { q: 'Riceverò una busta paga?',
        a: 'Sì, ricevi un riepilogo PDF dei guadagni alla fine di ogni mese. Per regime fiscale chiedi al commercialista.' },
    ],
  },
  {
    icon: '🛡️',
    title: 'Sicurezza e supporto',
    items: [
      { q: 'Sono assicurato?',
        a: 'Sì, MyCity stipula una polizza RC obbligatoria per ogni rider attivo. Per gli infortuni gravi attiva subito il supporto al 0523 000000.' },
      { q: 'Cosa succede se un cliente è aggressivo?',
        a: 'Allontanati. Chiama il supporto. La consegna viene annullata e pagata come fatta. Eventuali abusi portano al ban del cliente.' },
      { q: 'Posso lavorare anche con altre piattaforme?',
        a: 'Sì, sei libero. Non c\'è esclusiva.' },
    ],
  },
  {
    icon: '⭐',
    title: 'Rating e qualità',
    items: [
      { q: 'Cosa serve per essere "Top rider"?',
        a: 'Rating medio ≥ 4.5 negli ultimi 90 giorni + 50+ consegne. Ricevi consegne prioritarie e il badge nel profilo.' },
      { q: 'Cosa succede se il mio rating scende?',
        a: 'Sotto 4.0 ricevi un avviso. Sotto 3.5 il supporto ti contatta per capire come migliorare insieme.' },
    ],
  },
];

export default function RiderHelpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-ink-900">💡 Centro rider</h1>
        <p className="text-sm text-ink-500">Guide pratiche per consegnare al meglio.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <Link href="/contact" className="bg-gradient-to-br from-accent-500 to-orange-500 text-white rounded-xl p-5 hover:shadow-lg transition-all">
          <div className="text-2xl mb-2">✉️</div>
          <p className="font-bold">Contatta il supporto</p>
          <p className="text-xs text-accent-100 mt-1">Risposta entro 24h</p>
        </Link>
        <a href="tel:+390523000000" className="bg-white border rounded-xl p-5 hover:shadow-md hover:border-rose-300 transition-all">
          <div className="text-2xl mb-2">📞</div>
          <p className="font-bold text-ink-900">Emergenza</p>
          <p className="text-xs text-ink-500 mt-1">+39 0523 000000 · 24/7</p>
        </a>
        <a href="https://wa.me/393000000000" target="_blank" rel="noopener noreferrer" className="bg-white border rounded-xl p-5 hover:shadow-md hover:border-green-300 transition-all">
          <div className="text-2xl mb-2">💬</div>
          <p className="font-bold text-ink-900">WhatsApp rider</p>
          <p className="text-xs text-ink-500 mt-1">Lun-Dom 7-23</p>
        </a>
      </div>

      <div className="space-y-6">
        {TOPICS.map((topic) => (
          <section key={topic.title} className="bg-white border rounded-xl p-5">
            <h2 className="font-bold text-ink-900 mb-3 flex items-center gap-2 text-lg">
              <span className="text-2xl">{topic.icon}</span> {topic.title}
            </h2>
            <div className="space-y-3">
              {topic.items.map((it) => (
                <details key={it.q} className="group">
                  <summary className="cursor-pointer font-semibold text-ink-800 hover:text-accent-600 list-none flex items-start justify-between gap-2">
                    <span>{it.q}</span>
                    <span className="text-ink-400 group-open:rotate-45 transition-transform text-xl leading-none">+</span>
                  </summary>
                  <p className="text-sm text-ink-600 mt-2 leading-relaxed pl-1">{it.a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

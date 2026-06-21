import Link from 'next/link';
import {
  Construction,
  MapPin,
  Banknote,
  ShieldCheck,
  Star,
  ArrowLeft,
  Mail,
  Phone,
  MessageCircle,
  Headphones,
  type LucideIcon,
} from 'lucide-react';

export const metadata = {
  title: 'Centro rider · MyCity',
};

const TOPICS: { icon: LucideIcon; title: string; items: { q: string; a: string }[] }[] = [
  {
    icon: Construction,
    title: 'Inizio turno',
    items: [
      { q: 'Come ricevo le prime consegne?',
        a: 'Vai online dalla pagina "Disponibilità". Quando un ordine è pronto in zona riceverai una notifica push.' },
      { q: 'Posso scegliere le consegne?',
        a: 'Sì. Dalla dashboard rider clicchi "Accetta" sulle consegne disponibili. Nessuna penalità se rifiuti.' },
      { q: 'Quante consegne posso fare in parallelo?',
        a: 'Una alla volta. Quando hai consegnato, vedi subito la prossima disponibile.' },
    ],
  },
  {
    icon: MapPin,
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
    icon: Banknote,
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
    icon: ShieldCheck,
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
    icon: Star,
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
    <div className="pb-5">
      {/* Header serif con back, in stile telefono rider */}
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-3">
        <Link
          href="/rider/profile"
          aria-label="Indietro"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-700 hover:bg-cream-100"
        >
          <ArrowLeft size={20} aria-hidden />
        </Link>
        <h1 className="font-serif text-[22px] font-extrabold text-ink-900">Aiuto</h1>
      </div>

      <div className="space-y-3.5 px-4">
        {/* FAQ accordions */}
        {TOPICS.map((topic) => (
          <section key={topic.title}>
            <h2 className="mb-2 flex items-center gap-2 px-1 text-[13px] font-bold uppercase tracking-[0.03em] text-ink-700">
              <topic.icon size={15} strokeWidth={2.2} aria-hidden /> {topic.title}
            </h2>
            <div className="flex flex-col gap-2">
              {topic.items.map((it) => (
                <details
                  key={it.q}
                  className="group rounded-lg border border-cream-300 bg-surface-0 px-3.5 py-3"
                >
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-2 text-sm font-semibold text-ink-900">
                    <span>{it.q}</span>
                    <span className="text-xl leading-none text-ink-400 transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-600">{it.a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}

        {/* CTA piena larghezza: contatta il supporto rider */}
        <Link
          href="/contact"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-700 px-4 py-3.5 text-sm font-bold text-white hover:bg-primary-800"
        >
          <Headphones size={18} strokeWidth={2.2} aria-hidden /> Contatta il supporto rider
        </Link>

        {/* Canali rapidi (link conservati) */}
        <div className="flex flex-col gap-2">
          <a
            href="tel:+390523000000"
            className="flex items-center gap-3 rounded-lg border border-cream-300 bg-surface-0 px-3.5 py-3 hover:bg-cream-50"
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary-50">
              <Phone size={17} className="text-secondary-600" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink-900">Emergenza</p>
              <p className="text-xs text-ink-500">+39 0523 000000 · 24/7</p>
            </div>
          </a>
          <a
            href="https://wa.me/393000000000"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg border border-cream-300 bg-surface-0 px-3.5 py-3 hover:bg-cream-50"
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-olive-50">
              <MessageCircle size={17} className="text-olive-700" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink-900">WhatsApp rider</p>
              <p className="text-xs text-ink-500">Lun-Dom 7-23</p>
            </div>
          </a>
          <Link
            href="/contact"
            className="flex items-center gap-3 rounded-lg border border-cream-300 bg-surface-0 px-3.5 py-3 hover:bg-cream-50"
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-50">
              <Mail size={17} className="text-accent-700" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink-900">Scrivi al supporto</p>
              <p className="text-xs text-ink-500">Risposta entro 24h</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}

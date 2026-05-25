'use client';

import { Truck, Banknote, MapPin, Zap, Gift, Clock } from 'lucide-react';

const ITEMS = [
  { icon: Truck,   text: 'Spedizione gratuita sopra €30' },
  { icon: Banknote,text: 'Pagamento alla consegna' },
  { icon: MapPin,  text: 'Venditori 100% locali' },
  { icon: Zap,     text: 'Consegna in 24-48h' },
  { icon: Gift,    text: 'Iscriviti e prendi €5 di sconto al primo ordine' },
  { icon: Clock,   text: 'Drop del giorno ogni sera alle 18:00' },
];

/**
 * Ticker promo che scorre orizzontalmente in loop. Senza JS: solo CSS marquee.
 * Pause on hover (in CSS), screen-reader-friendly (lista leggibile).
 */
export default function PromoTicker() {
  // Doppia copia per loop seamless con translateX -50%
  const doubled = [...ITEMS, ...ITEMS];
  return (
    <div className="bg-ink-900 text-ink-100 text-xs sm:text-sm border-b border-ink-800 overflow-hidden">
      <div className="container mx-auto px-4 py-2 overflow-hidden">
        <div className="flex items-center gap-8 sm:gap-12 whitespace-nowrap animate-marquee" style={{ width: 'max-content' }}>
          {doubled.map((item, i) => {
            const Icon = item.icon;
            return (
              <span key={i} className="flex items-center gap-1.5 shrink-0">
                <Icon size={14} strokeWidth={2.2} className="text-accent-400" />
                <span className="font-medium">{item.text}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

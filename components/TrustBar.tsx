'use client';

import { Truck, Banknote, MapPin, Zap } from 'lucide-react';
import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';

const messages = [
  { Icon: Truck,    text: `Spedizione gratuita sopra €${FREE_SHIPPING_THRESHOLD}` },
  { Icon: Banknote, text: 'Pagamento alla consegna' },
  { Icon: MapPin,   text: 'Venditori 100% locali' },
  { Icon: Zap,      text: 'Consegna in 24-48h' },
];

const TrustBar = () => (
  <div className="bg-gray-950 text-gray-200 text-xs sm:text-sm border-b border-gray-800">
    <div className="container mx-auto px-4 py-2 flex items-center justify-start sm:justify-center gap-6 overflow-x-auto scrollbar-hide whitespace-nowrap">
      {messages.map(({ Icon, text }, i) => (
        <span key={i} className="flex items-center gap-1.5 shrink-0">
          <Icon size={14} strokeWidth={2} className="text-indigo-400" />
          <span className="font-medium">{text}</span>
        </span>
      ))}
    </div>
  </div>
);

export default TrustBar;

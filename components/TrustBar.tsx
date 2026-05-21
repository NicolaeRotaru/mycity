'use client';

import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';

const messages = [
  `🚚 Spedizione GRATUITA sopra €${FREE_SHIPPING_THRESHOLD}`,
  '💰 Pagamento alla consegna in contanti',
  '🏘️ Venditori 100% locali di Piacenza',
  '⚡ Consegna in 24-48h nella tua zona',
];

const TrustBar = () => (
  <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white text-xs sm:text-sm overflow-hidden">
    <div className="container mx-auto px-4 py-1.5 flex items-center justify-center gap-6 overflow-x-auto scrollbar-hide whitespace-nowrap font-medium">
      {messages.map((m, i) => (
        <span key={i} className="flex items-center">{m}</span>
      ))}
    </div>
  </div>
);

export default TrustBar;

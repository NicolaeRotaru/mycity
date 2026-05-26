'use client';

import dynamic from 'next/dynamic';

// Leaflet pesa ~170KB + CSS. Lo carichiamo solo al mount in client
// per non gonfiare il bundle iniziale di pagine che potrebbero non
// mostrare mai la mappa.
const DeliveryMapLazy = dynamic(() => import('./DeliveryMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-72 rounded-lg border bg-cream-50 flex items-center justify-center text-ink-400 text-sm">
      Caricamento mappa…
    </div>
  ),
});

export default DeliveryMapLazy;
export type { MapPoint } from './DeliveryMap';

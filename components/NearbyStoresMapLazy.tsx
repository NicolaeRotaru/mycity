'use client';

import dynamic from 'next/dynamic';

// Leaflet pesa ~170KB + CSS: lo carichiamo solo quando l'utente apre la vista
// "Mappa" (montato/smontato dal toggle), così la pagina /near resta leggera.
const NearbyStoresMapLazy = dynamic(() => import('./NearbyStoresMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[70vh] rounded-2xl border border-surface-200 bg-cream-50 flex items-center justify-center text-ink-400 text-sm">
      Caricamento mappa…
    </div>
  ),
});

export default NearbyStoresMapLazy;
export type { NearbyStore } from './NearbyStoresMap';

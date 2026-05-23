'use client';

import dynamic from 'next/dynamic';

const StoreLocationPickerLazy = dynamic(() => import('./StoreLocationPicker'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-72 rounded-lg border bg-gray-50 flex items-center justify-center text-gray-400 text-sm">
      Caricamento mappa…
    </div>
  ),
});

export default StoreLocationPickerLazy;
export type { StoreLocation } from './StoreLocationPicker';

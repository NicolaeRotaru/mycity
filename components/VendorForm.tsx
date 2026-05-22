'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import StoreLocationPicker, { StoreLocation } from './StoreLocationPicker';

const VendorSchema = z.object({
  storeName:  z.string().min(3, 'Il nome deve essere di almeno 3 caratteri'),
  storePhone: z.string().length(10, 'Il numero di telefono deve essere di 10 cifre'),
});

type SchemaData = z.infer<typeof VendorSchema>;

export type VendorFormData = SchemaData & {
  storeAddress: string;
  storeLat: number;
  storeLng: number;
};

interface Props {
  onSubmit: (data: VendorFormData) => void;
  isLoading?: boolean;
  defaultValues?: Partial<VendorFormData>;
}

const VendorForm = ({ onSubmit, isLoading = false, defaultValues }: Props) => {
  const { register, handleSubmit, formState: { errors } } = useForm<SchemaData>({
    resolver: zodResolver(VendorSchema),
    defaultValues: {
      storeName:  defaultValues?.storeName  ?? '',
      storePhone: defaultValues?.storePhone ?? '',
    },
  });

  const [location, setLocation] = useState<StoreLocation>({
    address: defaultValues?.storeAddress ?? '',
    lat:     defaultValues?.storeLat     ?? 45.0526,
    lng:     defaultValues?.storeLng     ?? 9.6929,
  });
  const [locationError, setLocationError] = useState<string | null>(null);

  const handleFormSubmit = (data: SchemaData) => {
    if (!location.address.trim()) {
      setLocationError("Inserisci l'indirizzo del negozio");
      return;
    }
    const validCoords =
      Number.isFinite(location.lat) && Number.isFinite(location.lng) &&
      location.lat >= -90 && location.lat <= 90 &&
      location.lng >= -180 && location.lng <= 180;
    if (!validCoords) {
      setLocationError('Coordinate non valide. Cerca un indirizzo, usa la tua posizione, o sposta il pin sulla mappa.');
      return;
    }
    onSubmit({
      ...data,
      storeAddress: location.address,
      storeLat: location.lat,
      storeLng: location.lng,
    });
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nome del negozio</label>
        <input
          {...register('storeName')}
          type="text"
          placeholder="Es. Panificio Rossi"
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        {errors.storeName && <p className="text-red-500 text-sm mt-1">{errors.storeName.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Telefono</label>
        <input
          {...register('storePhone')}
          type="text"
          placeholder="3331234567 (10 cifre)"
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        {errors.storePhone && <p className="text-red-500 text-sm mt-1">{errors.storePhone.message}</p>}
      </div>

      <StoreLocationPicker
        defaultValue={{
          address: defaultValues?.storeAddress,
          lat:     defaultValues?.storeLat,
          lng:     defaultValues?.storeLng,
        }}
        onChange={(loc) => {
          setLocation(loc);
          if (loc.address.trim()) setLocationError(null);
        }}
      />
      {locationError && <p className="text-red-500 text-sm">{locationError}</p>}

      <button
        type="submit"
        disabled={isLoading}
        className="bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white px-6 py-3 rounded font-semibold transition-colors"
      >
        {isLoading ? 'Salvataggio...' : 'Salva negozio'}
      </button>
    </form>
  );
};

export default VendorForm;

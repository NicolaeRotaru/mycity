'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import StoreLocationPicker, { StoreLocation } from './StoreLocationPickerLazy';
import StoreAvatar from './StoreAvatar';
import StoreMediaManager from './StoreMediaManager';
import { supabase } from '@/lib/supabase/client';
import type { StoreMediaItem } from './StoreMediaCarousel';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';

const VendorSchema = z.object({
  storeName:  z.string().min(3, 'Il nome deve essere di almeno 3 caratteri'),
  storePhone: z.string().length(10, 'Il numero di telefono deve essere di 10 cifre'),
});

type SchemaData = z.infer<typeof VendorSchema>;

export type VendorFormData = SchemaData & {
  storeAddress: string;
  storeLat: number;
  storeLng: number;
  storeLogo: string | null;
  storeDescription: string;
  storeMedia: StoreMediaItem[];
};

interface Props {
  onSubmit: (data: VendorFormData) => void;
  isLoading?: boolean;
  defaultValues?: Partial<VendorFormData>;
}

const VendorForm = ({ onSubmit, isLoading = false, defaultValues }: Props) => {
  const { register, handleSubmit, watch, formState: { errors } } = useForm<SchemaData>({
    resolver: zodResolver(VendorSchema),
    defaultValues: {
      storeName:  defaultValues?.storeName  ?? '',
      storePhone: defaultValues?.storePhone ?? '',
    },
  });

  const [location, setLocation] = useState<StoreLocation>({
    address: defaultValues?.storeAddress ?? '',
    lat:     defaultValues?.storeLat     ?? 41.9028,
    lng:     defaultValues?.storeLng     ?? 12.4964,
  });
  const [locationError, setLocationError] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(defaultValues?.storeLogo ?? null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [media, setMedia] = useState<StoreMediaItem[]>(defaultValues?.storeMedia ?? []);
  const [description, setDescription] = useState<string>(defaultValues?.storeDescription ?? '');

  const storeName = watch('storeName');

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': [] },
    maxFiles: 1,
    onDrop: async (files) => {
      const file = files[0];
      if (!file) return;
      setUploadingLogo(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Non autenticato');
        const ext = file.name.split('.').pop() ?? 'png';
        const path = `logos/${user.id}/${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from('products').upload(path, file, {
          upsert: true,
          contentType: file.type,
        });
        if (error) throw error;
        const { data } = supabase.storage.from('products').getPublicUrl(path);
        setLogoUrl(data.publicUrl);
        toast.success('Logo caricato');
      } catch (err: any) {
        toast.error(friendlyError(err));
      } finally {
        setUploadingLogo(false);
      }
    },
  });

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
      storeLogo: logoUrl,
      storeMedia: media,
      storeDescription: description.trim(),
    });
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
      {/* Logo upload */}
      <div>
        <label className="block text-sm font-medium text-ink-700 mb-2">Logo del negozio</label>
        <div className="flex items-center gap-4">
          <StoreAvatar logoUrl={logoUrl} storeName={storeName || defaultValues?.storeName} size="lg" />
          <div
            {...getRootProps()}
            className={`flex-1 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors text-sm ${
              isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 hover:border-cream-400'
            } ${uploadingLogo ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <input {...getInputProps()} />
            {uploadingLogo ? (
              <LoadingState variant="inline" />
            ) : logoUrl ? (
              <p className="text-ink-600">
                <span className="font-medium">Sostituisci</span> · trascina o clicca
              </p>
            ) : (
              <p className="text-ink-500">
                <span className="font-medium text-primary-700">Carica</span> un'immagine quadrata (PNG, JPG)
              </p>
            )}
          </div>
          {logoUrl && (
            <button
              type="button"
              onClick={() => setLogoUrl(null)}
              className="text-sm text-ink-500 hover:text-red-600 underline"
            >
              Rimuovi
            </button>
          )}
        </div>
      </div>

      {/* Cover media gallery */}
      <StoreMediaManager value={media} onChange={setMedia} />

      <div>
        <label className="block text-sm font-medium text-ink-700 mb-1">Nome del negozio</label>
        <input
          {...register('storeName')}
          type="text"
          placeholder="Es. Panificio Rossi"
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
        {errors.storeName && <p className="text-red-500 text-sm mt-1">{errors.storeName.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-ink-700 mb-1">Descrizione (opzionale)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Cosa rende speciale il tuo negozio? Storia, tradizione, prodotti tipici…"
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink-700 mb-1">Telefono</label>
        <input
          {...register('storePhone')}
          type="text"
          placeholder="3331234567 (10 cifre)"
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
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
        disabled={isLoading || uploadingLogo}
        className="bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white px-6 py-3 rounded font-semibold transition-colors"
      >
        {isLoading ? 'Salvataggio...' : 'Salva negozio'}
      </button>
    </form>
  );
};

export default VendorForm;

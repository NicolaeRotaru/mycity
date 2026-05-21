'use client';

import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

const VendorSchema = z.object({
  storeName: z.string().min(3, 'Il nome deve essere di almeno 3 caratteri'),
  storeLat: z.coerce.number({ invalid_type_error: 'Inserisci una latitudine valida' }),
  storeLng: z.coerce.number({ invalid_type_error: 'Inserisci una longitudine valida' }),
  storePhone: z.string().length(10, 'Il numero di telefono deve essere di 10 cifre'),
});

export type VendorFormData = z.infer<typeof VendorSchema>;

interface VendorFormProps {
  onSubmit: (data: VendorFormData) => void;
  isLoading?: boolean;
  defaultValues?: Partial<VendorFormData>;
}

const VendorForm = ({ onSubmit, isLoading = false, defaultValues }: VendorFormProps) => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VendorFormData>({
    resolver: zodResolver(VendorSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nome del negozio</label>
        <input
          {...register('storeName')}
          type="text"
          placeholder="Nome del negozio"
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        {errors.storeName && <p className="text-red-500 text-sm mt-1">{errors.storeName.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Latitudine</label>
          <input
            {...register('storeLat')}
            type="number"
            step="any"
            placeholder="45.0526"
            className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          {errors.storeLat && <p className="text-red-500 text-sm mt-1">{errors.storeLat.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Longitudine</label>
          <input
            {...register('storeLng')}
            type="number"
            step="any"
            placeholder="9.6929"
            className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          {errors.storeLng && <p className="text-red-500 text-sm mt-1">{errors.storeLng.message}</p>}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Telefono</label>
        <input
          {...register('storePhone')}
          type="text"
          placeholder="Telefono (10 cifre)"
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        {errors.storePhone && <p className="text-red-500 text-sm mt-1">{errors.storePhone.message}</p>}
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white px-4 py-2 rounded transition-colors"
      >
        {isLoading ? 'Salvataggio...' : 'Salva'}
      </button>
    </form>
  );
};

export default VendorForm;

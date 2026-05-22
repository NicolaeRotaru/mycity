'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import PhotoFillButton, { ExtractedProduct } from '@/components/seller/PhotoFillButton';

const Schema = z.object({
  name: z.string().min(3, 'Almeno 3 caratteri'),
  description: z.string().min(10, 'Almeno 10 caratteri'),
  price: z.coerce.number().positive('Inserisci un prezzo valido'),
  stock: z.coerce.number().int().min(0).default(0),
  category_id: z.string().min(1, 'Seleziona una categoria'),
});

type FormData = z.infer<typeof Schema>;

export default function NewProductPage() {
  const router = useRouter();
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['cats-form'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(Schema),
  });

  const handleExtracted = (data: ExtractedProduct) => {
    if (data.name) setValue('name', data.name, { shouldValidate: true });
    if (data.description) setValue('description', data.description, { shouldValidate: true });
    if (data.suggested_price && data.suggested_price > 0) {
      setValue('price', data.suggested_price as unknown as number, { shouldValidate: true });
    }
    if (data.category_id) {
      setValue('category_id', data.category_id, { shouldValidate: true });
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': [] },
    onDrop: async (files) => {
      setUploading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Non autenticato');

        const uploaded: string[] = [];
        for (const file of files) {
          const path = `${user.id}/${Date.now()}-${file.name}`;
          const { error } = await supabase.storage.from('products').upload(path, file);
          if (error) throw error;
          const { data } = supabase.storage.from('products').getPublicUrl(path);
          uploaded.push(data.publicUrl);
        }
        setImageUrls((prev) => [...prev, ...uploaded]);
        toast.success('Immagini caricate');
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setUploading(false);
      }
    },
  });

  const create = useMutation({
    mutationFn: async (form: FormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase.from('products').insert({
        name: form.name,
        description: form.description,
        price: form.price,
        stock: form.stock,
        category_id: form.category_id,
        seller_id: user.id,
        images: imageUrls,
        status: 'available',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Prodotto pubblicato!');
      router.push('/seller/products');
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Nuovo prodotto</h1>

      <PhotoFillButton onFilled={handleExtracted} />

      <form onSubmit={handleSubmit((d) => create.mutate(d))} className="bg-white border rounded-lg p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Nome prodotto</label>
          <input {...register('name')} className="w-full border p-2 rounded" placeholder="Es. Pomodori biologici" />
          {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Descrizione</label>
          <textarea {...register('description')} rows={4} className="w-full border p-2 rounded" />
          {errors.description && <p className="text-red-500 text-sm mt-1">{errors.description.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Prezzo (€)</label>
            <input type="number" step="0.01" {...register('price')} className="w-full border p-2 rounded" />
            {errors.price && <p className="text-red-500 text-sm mt-1">{errors.price.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Disponibilità</label>
            <input type="number" {...register('stock')} className="w-full border p-2 rounded" defaultValue={1} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Categoria</label>
          <select {...register('category_id')} className="w-full border p-2 rounded">
            <option value="">Seleziona...</option>
            {categories.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {errors.category_id && <p className="text-red-500 text-sm mt-1">{errors.category_id.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Immagini</label>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragActive ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400'
            }`}
          >
            <input {...getInputProps()} />
            {uploading
              ? <p className="text-gray-500">Caricamento...</p>
              : <p className="text-gray-500">Trascina qui le foto o clicca per selezionarle</p>
            }
          </div>
          {imageUrls.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mt-3">
              {imageUrls.map((url, i) => (
                <div key={url} className="relative aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover rounded" />
                  <button
                    type="button"
                    onClick={() => setImageUrls((u) => u.filter((_, j) => j !== i))}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={create.isPending}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-3 rounded-lg font-semibold"
        >
          {create.isPending ? 'Pubblicazione...' : 'Pubblica prodotto'}
        </button>
      </form>
    </div>
  );
}

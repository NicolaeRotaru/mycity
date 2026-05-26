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
import AttributesFields from '@/components/seller/AttributesFields';
import AIDescriptionButton from '@/components/AIDescriptionButton';
import { getAttributesForCategory } from '@/lib/category-attributes';

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
  const [attributes, setAttributes] = useState<Record<string, unknown>>({});

  const { data: categories = [] } = useQuery({
    queryKey: ['cats-form'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, slug, parent_id')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(Schema),
  });

  const selectedCategoryId = watch('category_id');
  const { fields: attrFields, topSlug } = getAttributesForCategory(
    categories as any,
    selectedCategoryId,
  );
  const topCategoryLabel = topSlug
    ? (categories.find((c: any) => c.slug === topSlug)?.name as string | undefined)
    : undefined;

  const setAttribute = (key: string, value: unknown) => {
    setAttributes((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '' || value === null) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

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
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png':  ['.png'],
      'image/webp': ['.webp'],
    },
    maxSize: 5 * 1024 * 1024,           // 5 MB per file
    maxFiles: 8,                          // max foto per upload
    onDropRejected: (rejections) => {
      const reason = rejections[0]?.errors[0]?.code;
      if (reason === 'file-too-large')        toast.error('File troppo grande (max 5 MB)');
      else if (reason === 'file-invalid-type') toast.error('Formato non supportato (solo JPG, PNG, WEBP)');
      else if (reason === 'too-many-files')   toast.error('Massimo 8 foto per upload');
      else                                     toast.error('File non valido');
    },
    onDrop: async (files) => {
      setUploading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Non autenticato');

        const uploaded: string[] = [];
        for (const file of files) {
          // Double-check lato client prima di committare a storage
          if (file.size > 5 * 1024 * 1024) {
            throw new Error(`File "${file.name}" troppo grande (max 5 MB)`);
          }
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            throw new Error(`Formato non valido per "${file.name}"`);
          }
          // Sanitizza il nome file: niente path traversal, solo charset safe
          const safeName = file.name
            .toLowerCase()
            .replace(/[^a-z0-9.\-_]/g, '_')
            .slice(-80);
          const ext = file.type.split('/')[1];
          const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName || `img.${ext}`}`;
          const { error } = await supabase.storage
            .from('products')
            .upload(path, file, {
              cacheControl: '3600',
              upsert: false,
              contentType: file.type,
            });
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
        attributes,
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
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium">Descrizione</label>
            <AIDescriptionButton
              productName={watch('name') ?? ''}
              categoryName={categories.find((c: any) => c.id === selectedCategoryId)?.name}
              currentText={watch('description') ?? ''}
              onResult={(text) => setValue('description', text, { shouldValidate: true })}
            />
          </div>
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

        <div className="border-t pt-4">
          <AttributesFields
            fields={attrFields}
            values={attributes}
            onChange={setAttribute}
            categoryLabel={topCategoryLabel}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Immagini</label>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 hover:border-primary-400'
            }`}
          >
            <input {...getInputProps()} />
            {uploading
              ? <p className="text-ink-500">Caricamento...</p>
              : <p className="text-ink-500">Trascina qui le foto o clicca per selezionarle</p>
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
          className="w-full bg-primary-700 hover:bg-primary-800 disabled:opacity-50 text-white py-3 rounded-lg font-semibold"
        >
          {create.isPending ? 'Pubblicazione...' : 'Pubblica prodotto'}
        </button>
      </form>
    </div>
  );
}

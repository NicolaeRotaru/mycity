'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import AttributesFields from '@/components/seller/AttributesFields';
import AIDescriptionButton from '@/components/AIDescriptionButton';
import { confirmDialog } from '@/components/ConfirmDialog';
import { getAttributesForCategory } from '@/lib/category-attributes';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

const Schema = z.object({
  name: z.string().min(3, 'Almeno 3 caratteri'),
  description: z.string().min(10, 'Almeno 10 caratteri'),
  price: z.coerce.number().positive('Inserisci un prezzo valido'),
  stock: z.coerce.number().int().min(0).default(0),
  category_id: z.string().min(1, 'Seleziona una categoria'),
});

type FormData = z.infer<typeof Schema>;

export default function EditProductPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const qc = useQueryClient();
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attributes, setAttributes] = useState<Record<string, unknown>>({});

  // Carica il prodotto (con check di proprietà)
  const { data: product, isLoading, error } = useQuery({
    queryKey: queryKeys.seller.product(id),
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('products')
        .select('id, name, description, price, stock, category_id, images, attributes, seller_id, status')
        .eq('id', id)
        .single();
      if (error) throw error;
      if (data.seller_id !== user.id) {
        throw new Error('Non puoi modificare un prodotto che non è tuo');
      }
      return data;
    },
  });

  type CategoryRow = { id: string; name: string; slug: string; parent_id: string | null };
  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories.form,
    queryFn: async (): Promise<CategoryRow[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, slug, parent_id')
        .order('name');
      if (error) throw error;
      return (data ?? []) as CategoryRow[];
    },
  });

  const { register, handleSubmit, setValue, watch, reset, formState: { errors, isDirty } } = useForm<FormData>({
    resolver: zodResolver(Schema),
  });

  // Quando i dati arrivano, precompila il form
  useEffect(() => {
    if (!product) return;
    reset({
      name: product.name ?? '',
      description: product.description ?? '',
      price: Number(product.price) || 0,
      stock: product.stock ?? 0,
      category_id: product.category_id ?? '',
    });
    setImageUrls(Array.isArray(product.images) ? product.images : []);
    setAttributes((product.attributes as Record<string, unknown>) ?? {});
  }, [product, reset]);

  const selectedCategoryId = watch('category_id');
  const { fields: attrFields, topSlug } = getAttributesForCategory(
    categories,
    selectedCategoryId,
  );
  const topCategoryLabel = topSlug
    ? (categories.find((c: { slug: string; name: string }) => c.slug === topSlug)?.name)
    : undefined;

  const setAttribute = (key: string, value: unknown) => {
    setAttributes((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '' || value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png':  ['.png'],
      'image/webp': ['.webp'],
    },
    maxSize: 5 * 1024 * 1024,
    maxFiles: 8,
    onDropRejected: (rejections) => {
      const reason = rejections[0]?.errors[0]?.code;
      if (reason === 'file-too-large')          toast.error('File troppo grande (max 5 MB)');
      else if (reason === 'file-invalid-type')  toast.error('Formato non supportato (JPG, PNG, WEBP)');
      else if (reason === 'too-many-files')     toast.error('Massimo 8 foto per upload');
      else                                       toast.error('File non valido');
    },
    onDrop: async (files) => {
      setUploading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Non autenticato');
        const uploaded: string[] = [];
        for (const file of files) {
          if (file.size > 5 * 1024 * 1024) throw new Error(`"${file.name}" troppo grande`);
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            throw new Error(`Formato non valido per "${file.name}"`);
          }
          const safeName = file.name.toLowerCase().replace(/[^a-z0-9.\-_]/g, '_').slice(-80);
          const ext = file.type.split('/')[1];
          const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName || `img.${ext}`}`;
          const { error } = await supabase.storage
            .from('products')
            .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
          if (error) throw error;
          const { data } = supabase.storage.from('products').getPublicUrl(path);
          uploaded.push(data.publicUrl);
        }
        setImageUrls((prev) => [...prev, ...uploaded]);
        toast.success('Immagini caricate');
      } catch (err) {
        toast.error(friendlyError(err));
      } finally {
        setUploading(false);
      }
    },
  });

  const update = useMutation({
    mutationFn: async (form: FormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase.from('products').update({
        name: form.name,
        description: form.description,
        price: form.price,
        stock: form.stock,
        category_id: form.category_id,
        images: imageUrls,
        attributes,
      }).eq('id', id).eq('seller_id', user.id); // doppio check di proprietà
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.products });
      qc.invalidateQueries({ queryKey: queryKeys.seller.product(id) });
      qc.invalidateQueries({ queryKey: queryKeys.products.detail(id) });
      toast.success('Modifiche salvate');
      router.push('/seller/products');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const removeProduct = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase
        .from('products').delete()
        .eq('id', id).eq('seller_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.products });
      toast.success('Prodotto eliminato');
      router.push('/seller/products');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (isLoading) return <LoadingState />;
  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-900 max-w-2xl">
        <p className="font-bold mb-1">⚠️ Errore</p>
        <p className="text-sm mb-3">{error instanceof Error ? error.message : 'Errore sconosciuto'}</p>
        <Link href="/seller/products" className="text-sm font-semibold text-rose-700 hover:underline">
          ← Torna ai miei prodotti
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link href="/seller/products" className="text-sm text-primary-700 hover:underline">
            ← I miei prodotti
          </Link>
          <h1 className="text-2xl font-bold mt-1">Modifica prodotto</h1>
          {product?.status === 'sold' && (
            <p className="text-xs text-accent-700 bg-accent-50 inline-block px-2 py-0.5 rounded mt-1">
              ⚠ Attualmente segnato come esaurito — non è visibile ai clienti
            </p>
          )}
        </div>
        <Link
          href={`/product/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm bg-cream-100 hover:bg-cream-200 px-3 py-1.5 rounded font-semibold"
        >
          👁 Vedi pubblico
        </Link>
      </div>

      <form onSubmit={handleSubmit((d) => update.mutate(d))} className="bg-white border rounded-lg p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Nome prodotto</label>
          <input {...register('name')} className="w-full border p-2 rounded" />
          {errors.name && <p role="alert" aria-live="polite" className="text-rose-600 text-sm mt-1">{errors.name.message}</p>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium">Descrizione</label>
            <AIDescriptionButton
              productName={watch('name') ?? ''}
              categoryName={categories.find((c: { id: string; name: string }) => c.id === selectedCategoryId)?.name}
              currentText={watch('description') ?? ''}
              onResult={(text) => setValue('description', text, { shouldValidate: true, shouldDirty: true })}
            />
          </div>
          <textarea {...register('description')} rows={4} className="w-full border p-2 rounded" />
          {errors.description && <p role="alert" aria-live="polite" className="text-rose-600 text-sm mt-1">{errors.description.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Prezzo (€)</label>
            <input type="number" step="0.01" {...register('price')} className="w-full border p-2 rounded" />
            {errors.price && <p role="alert" aria-live="polite" className="text-rose-600 text-sm mt-1">{errors.price.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Disponibilità</label>
            <input type="number" {...register('stock')} className="w-full border p-2 rounded" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Categoria</label>
          <select {...register('category_id')} className="w-full border p-2 rounded">
            <option value="">Seleziona...</option>
            {categories.map((c: { id: string; name: string }) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {errors.category_id && <p role="alert" aria-live="polite" className="text-rose-600 text-sm mt-1">{errors.category_id.message}</p>}
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
              ? <LoadingState variant="inline" />
              : <p className="text-ink-500">Trascina nuove foto o clicca per selezionarle</p>}
          </div>
          {imageUrls.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mt-3">
              {imageUrls.map((url, i) => (
                <div key={url} className="relative aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" loading="lazy" className="w-full h-full object-cover rounded" />
                  <button
                    type="button"
                    onClick={() => setImageUrls((u) => u.filter((_, j) => j !== i))}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs"
                    aria-label="Rimuovi immagine"
                  >
                    ×
                  </button>
                  {i === 0 && (
                    <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                      Copertina
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-ink-400 mt-1">La prima foto è la copertina mostrata nelle liste.</p>
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2 pt-4 border-t">
          <button
            type="button"
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Eliminare il prodotto?',
                message: `"${product?.name}" verrà rimosso dal tuo catalogo. L'azione è irreversibile.`,
                confirmLabel: 'Sì, elimina',
                danger: true,
                icon: '🗑️',
              });
              if (ok) removeProduct.mutate();
            }}
            disabled={removeProduct.isPending}
            className="sm:w-auto px-4 py-3 rounded-lg font-semibold text-rose-700 bg-white border-2 border-rose-200 hover:bg-rose-50"
          >
            🗑 Elimina prodotto
          </button>
          <button
            type="submit"
            disabled={update.isPending || uploading || (!isDirty && imageUrls.join('|') === (Array.isArray(product?.images) ? product.images : []).join('|') && JSON.stringify(attributes) === JSON.stringify(product?.attributes ?? {}))}
            className="flex-1 bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-700 hover:to-purple-700 disabled:opacity-40 text-white py-3 rounded-lg font-bold shadow"
          >
            {update.isPending ? 'Salvataggio…' : '💾 Salva modifiche'}
          </button>
        </div>
      </form>
    </div>
  );
}

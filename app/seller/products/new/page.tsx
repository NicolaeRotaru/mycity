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
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Field';
import { queryKeys } from '@/lib/queries/keys';
import { trackProductPublished } from '@/lib/analytics/events';
import { formatPrice } from '@/lib/format';
import { Eye, Image as ImageIcon } from 'lucide-react';

const Schema = z.object({
  name: z.string().min(3, 'Almeno 3 caratteri'),
  description: z.string().min(30, 'Descrivi bene il prodotto: almeno 30 caratteri (materiali, taglia, condizione…)'),
  price: z.coerce.number().positive('Inserisci un prezzo valido'),
  stock: z.coerce.number().int().min(0).default(0),
  category_id: z.string().min(1, 'Seleziona una categoria'),
});

type FormData = z.infer<typeof Schema>;

export default function NewProductPage() {
  const router = useRouter();
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<Record<string, unknown>>({});

  type Category = { id: string; name: string; slug: string; parent_id: string | null };
  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories.form,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, slug, parent_id')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(Schema),
  });

  const selectedCategoryId = watch('category_id');
  const { fields: attrFields, topSlug } = getAttributesForCategory(
    categories,
    selectedCategoryId,
  );
  const topCategoryLabel = topSlug
    ? categories.find((c) => c.slug === topSlug)?.name
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
        setImageError(null);
        toast.success('Immagini caricate');
      } catch (err) {
        toast.error(friendlyError(err));
      } finally {
        setUploading(false);
      }
    },
  });

  const create = useMutation({
    mutationFn: async (form: FormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase.from('products').insert({
        name: form.name,
        description: form.description,
        price: form.price,
        stock: form.stock,
        category_id: form.category_id,
        seller_id: user.id,
        images: imageUrls,
        attributes,
        status: 'available',
      }).select('id').single();
      if (error) throw error;
      return { id: data.id as string, sellerId: user.id };
    },
    onSuccess: ({ id, sellerId }) => {
      trackProductPublished(id, sellerId);
      toast.success('Prodotto pubblicato!');
      router.push('/seller/products');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const onValid = (form: FormData) => {
    // Fabbrica della qualità: nessun annuncio senza foto. Gli annunci con foto
    // convertono molto di più — blocchiamo la pubblicazione e spieghiamo perché.
    if (imageUrls.length === 0) {
      setImageError('Aggiungi almeno una foto: senza immagini il prodotto non vende.');
      document.getElementById('image-dropzone')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    create.mutate(form);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Nuovo prodotto</h1>

      <PhotoFillButton onFilled={handleExtracted} />

      <form onSubmit={handleSubmit(onValid)} className="bg-white border rounded-lg p-6 space-y-4">
        <Input
          label="Nome prodotto"
          {...register('name')}
          placeholder="Es. Pomodori biologici"
          error={typeof errors.name?.message === 'string' ? errors.name.message : undefined}
        />

        <Textarea
          label="Descrizione"
          labelAction={
            <AIDescriptionButton
              productName={watch('name') ?? ''}
              categoryName={categories.find((c) => c.id === selectedCategoryId)?.name}
              currentText={watch('description') ?? ''}
              onResult={(text) => setValue('description', text, { shouldValidate: true })}
            />
          }
          {...register('description')}
          rows={4}
          placeholder="Cosa è, materiali, dimensioni/taglia, condizione, cosa lo rende speciale…"
          error={typeof errors.description?.message === 'string' ? errors.description.message : undefined}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Prezzo (€)"
            type="number"
            step="0.01"
            inputMode="decimal"
            {...register('price')}
            error={typeof errors.price?.message === 'string' ? errors.price.message : undefined}
          />
          <Input
            label="Disponibilità"
            type="number"
            inputMode="numeric"
            {...register('stock')}
            defaultValue={1}
          />
        </div>

        <Select
          label="Categoria"
          {...register('category_id')}
          error={typeof errors.category_id?.message === 'string' ? errors.category_id.message : undefined}
        >
          <option value="">Seleziona...</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>

        <div className="border-t pt-4">
          <AttributesFields
            fields={attrFields}
            values={attributes}
            onChange={setAttribute}
            categoryLabel={topCategoryLabel}
          />
        </div>

        <div id="image-dropzone">
          <label className="block text-sm font-medium mb-1">
            Foto del prodotto <span className="text-ink-400 font-normal">— almeno 1, consigliate 3</span>
          </label>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              imageError ? 'border-rose-300 bg-rose-50' : isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 hover:border-primary-400'
            }`}
          >
            <input {...getInputProps()} />
            {uploading
              ? <LoadingState variant="inline" />
              : <p className="text-ink-500">Trascina qui le foto o clicca per selezionarle</p>
            }
          </div>
          <p className="text-xs text-ink-400 mt-1">Luce naturale, sfondo pulito, prodotto centrato — è la prima cosa che convince chi compra.</p>
          {imageError && <p className="text-sm text-rose-600 mt-1">{imageError}</p>}
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
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ANTEPRIMA — come la vede il cliente, prima di pubblicare */}
        <div className="border-t pt-4 space-y-2">
          <h2 className="text-sm font-semibold text-ink-500 flex items-center gap-1.5">
            <Eye size={15} strokeWidth={2.2} aria-hidden /> Anteprima — come la vede il cliente
          </h2>
          <div className="bg-white border border-cream-300 rounded-xl overflow-hidden shadow-warm max-w-[16rem]">
            <div className="aspect-square bg-cream-100">
              {imageUrls[0] ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrls[0]} alt="" className="w-full h-full object-cover" />
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-ink-300">
                  <ImageIcon size={40} strokeWidth={1.5} aria-hidden />
                </div>
              )}
            </div>
            <div className="p-3">
              <p className="font-semibold text-ink-900 line-clamp-1">{watch('name') || 'Nome prodotto'}</p>
              <p className="text-sm text-ink-500 line-clamp-2 mt-0.5">{watch('description') || 'La descrizione apparirà qui…'}</p>
              <p className="font-bold text-primary-700 mt-1.5">{watch('price') ? formatPrice(Number(watch('price'))) : '€—'}</p>
            </div>
          </div>
        </div>

        <Button type="submit" loading={create.isPending} fullWidth size="lg">
          Pubblica prodotto
        </Button>
      </form>
    </div>
  );
}

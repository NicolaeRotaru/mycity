'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import AttributesFields from '@/components/seller/AttributesFields';
import ProductImagesField from '@/components/seller/ProductImagesField';
import AIDescriptionButton from '@/components/AIDescriptionButton';
import { confirmDialog } from '@/components/ConfirmDialog';
import { getAttributesForCategory } from '@/lib/category-attributes';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { Input, Textarea, Select } from '@/components/ui/Field';
import { queryKeys } from '@/lib/queries/keys';
import { Eye, AlertTriangle, Trash2, Save } from 'lucide-react';

const Schema = z.object({
  name: z.string().min(3, 'Almeno 3 caratteri'),
  description: z.string().min(10, 'Almeno 10 caratteri'),
  price: z.coerce.number().positive('Inserisci un prezzo valido'),
  stock: z.coerce.number().int().min(0).default(0),
  category_id: z.string().min(1, 'Seleziona una categoria'),
});

type FormData = z.infer<typeof Schema>;

export default function EditProductPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { id } = params;
  const router = useRouter();
  const qc = useQueryClient();
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
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

  const onValid = (form: FormData) => {
    // Stessa "fabbrica della qualità" del nuovo annuncio: niente foto = non vende.
    // Su modifica scatta solo se il venditore rimuove tutte le immagini.
    if (imageUrls.length === 0) {
      setImageError('Un prodotto senza foto non vende: aggiungi almeno una foto prima di salvare.');
      document.getElementById('image-dropzone')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    update.mutate(form);
  };

  if (isLoading) return <LoadingState />;
  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-900 max-w-2xl">
        <p className="font-bold mb-1 flex items-center gap-1.5"><AlertTriangle size={16} aria-hidden /> Errore</p>
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
            <p className="text-xs text-accent-700 bg-accent-50 inline-flex items-center gap-1 px-2 py-0.5 rounded mt-1">
              <AlertTriangle size={12} strokeWidth={2.4} aria-hidden /> Attualmente segnato come esaurito — non è visibile ai clienti
            </p>
          )}
        </div>
        <Link
          href={`/product/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm inline-flex items-center gap-1.5 bg-cream-100 hover:bg-cream-200 px-3 py-1.5 rounded font-semibold"
        >
          <Eye size={15} strokeWidth={2.2} aria-hidden /> Anteprima cliente
        </Link>
      </div>

      <form onSubmit={handleSubmit(onValid)} className="bg-white border rounded-lg p-6 space-y-4">
        <Input
          label="Nome prodotto"
          {...register('name')}
          error={typeof errors.name?.message === 'string' ? errors.name.message : undefined}
        />

        <Textarea
          label="Descrizione"
          labelAction={
            <AIDescriptionButton
              productName={watch('name') ?? ''}
              categoryName={categories.find((c: { id: string; name: string }) => c.id === selectedCategoryId)?.name}
              currentText={watch('description') ?? ''}
              onResult={(text) => setValue('description', text, { shouldValidate: true, shouldDirty: true })}
            />
          }
          {...register('description')}
          rows={4}
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
          />
        </div>

        <Select
          label="Categoria"
          {...register('category_id')}
          error={typeof errors.category_id?.message === 'string' ? errors.category_id.message : undefined}
        >
          <option value="">Seleziona...</option>
          {categories.map((c: { id: string; name: string }) => (
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

        <ProductImagesField
          value={imageUrls}
          onChange={setImageUrls}
          error={imageError}
          onUploadingChange={setUploading}
          onUploadSuccess={() => setImageError(null)}
          label={<>Immagini <span className="text-ink-400 font-normal">— almeno 1, consigliate 3</span></>}
          dropzoneHint="Trascina nuove foto o clicca per selezionarle"
          hint="La prima foto è la copertina mostrata nelle liste."
          showCoverBadge
        />

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
            className="sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold text-rose-700 bg-white border-2 border-rose-200 hover:bg-rose-50"
          >
            <Trash2 size={16} aria-hidden /> Elimina prodotto
          </button>
          <button
            type="submit"
            disabled={update.isPending || uploading || (!isDirty && imageUrls.join('|') === (Array.isArray(product?.images) ? product.images : []).join('|') && JSON.stringify(attributes) === JSON.stringify(product?.attributes ?? {}))}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-700 hover:to-purple-700 disabled:opacity-40 text-white py-3 rounded-lg font-bold shadow"
          >
            <Save size={18} aria-hidden /> {update.isPending ? 'Salvataggio…' : 'Salva modifiche'}
          </button>
        </div>
      </form>
    </div>
  );
}

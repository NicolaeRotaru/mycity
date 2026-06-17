'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import ProductForm, { type ProductInitialValues, type ProductPayload } from '@/components/seller/ProductForm';
import { confirmDialog } from '@/components/ConfirmDialog';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import { normalizeCondition, type ProductCondition, type ProductUnit } from '@/lib/products/schema';
import { type ProductVariant } from '@/lib/products/variants';
import { saveProductVariants, loadProductVariants } from '@/lib/products/persistVariants';
import { AlertTriangle, Trash2 } from 'lucide-react';

type Category = { id: string; name: string; slug: string; parent_id: string | null };

export default function EditProductPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const qc = useQueryClient();

  const { data: product, isLoading, error } = useQuery({
    queryKey: queryKeys.seller.product(id),
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('products')
        .select('id, name, description, price, compare_at_price, unit, condition, stock, category_id, images, attributes, tags, express_enabled, seller_id, status')
        .eq('id', id)
        .single();
      if (error) throw error;
      if ((data as { seller_id?: string }).seller_id !== user.id) {
        throw new Error('Non puoi modificare un prodotto che non è tuo');
      }
      return data as Record<string, unknown>;
    },
  });

  const { data: variants = [], isLoading: variantsLoading } = useQuery({
    queryKey: [...queryKeys.seller.product(id), 'variants'],
    queryFn: () => loadProductVariants(id),
  });

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories.form,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase.from('categories').select('id, name, slug, parent_id').order('name');
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });

  const { data: offersExpress = false } = useQuery({
    queryKey: [...queryKeys.seller.profile, 'offers-express'],
    queryFn: async (): Promise<boolean> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data } = await supabase.from('profiles').select('offers_express').eq('id', user.id).single();
      return Boolean((data as { offers_express?: boolean } | null)?.offers_express);
    },
  });

  const update = useMutation({
    mutationFn: async ({ payload, variants: nextVariants }: { payload: ProductPayload; variants: ProductVariant[] }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase.from('products').update(payload).eq('id', id).eq('seller_id', user.id);
      if (error) throw error;
      // Sincronizza le varianti (insert/update/delete); il trigger DB riallinea
      // products.stock e has_variants.
      await saveProductVariants(id, nextVariants);
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
      const { error } = await supabase.from('products').delete().eq('id', id).eq('seller_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.products });
      toast.success('Prodotto eliminato');
      router.push('/seller/products');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (isLoading || variantsLoading) return <LoadingState />;
  if (error || !product) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-900 max-w-2xl">
        <p className="font-bold mb-1 flex items-center gap-1.5"><AlertTriangle size={16} aria-hidden /> Errore</p>
        <p className="text-sm mb-3">{error instanceof Error ? error.message : 'Prodotto non trovato'}</p>
        <Link href="/seller/products" className="text-sm font-semibold text-rose-700 hover:underline">
          ← Torna ai miei prodotti
        </Link>
      </div>
    );
  }

  const attrs = (product.attributes as Record<string, unknown>) ?? {};
  const legacyStato = typeof attrs.stato === 'string' ? attrs.stato : '';
  const initialValues: ProductInitialValues = {
    name: (product.name as string) ?? '',
    description: (product.description as string) ?? '',
    price: (product.price as number) ?? undefined,
    compareAtPrice: (product.compare_at_price as number) ?? undefined,
    unit: ((product.unit as ProductUnit) ?? 'pezzo'),
    condition: ((product.condition as ProductCondition) ?? (normalizeCondition(legacyStato) || null)),
    stock: (product.stock as number | null) ?? null,
    category_id: (product.category_id as string) ?? '',
    images: Array.isArray(product.images) ? (product.images as string[]) : [],
    attributes: attrs,
    tags: Array.isArray(product.tags) ? (product.tags as string[]) : [],
    expressEnabled: (product.express_enabled as boolean | null) ?? null,
    status: (product.status as string) ?? 'available',
    variants,
  };

  const status = product.status as string;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/seller/products" className="text-sm text-primary-700 hover:underline">← I miei prodotti</Link>
        <h1 className="text-2xl font-bold mt-1">Modifica prodotto</h1>
        {status === 'sold' && (
          <p className="text-xs text-accent-700 bg-accent-50 inline-flex items-center gap-1 px-2 py-0.5 rounded mt-1">
            <AlertTriangle size={12} strokeWidth={2.4} aria-hidden /> Segnato come esaurito — non è visibile ai clienti
          </p>
        )}
        {status === 'draft' && (
          <p className="text-xs text-ink-600 bg-cream-100 inline-flex items-center gap-1 px-2 py-0.5 rounded mt-1">
            Bozza — non è ancora visibile ai clienti
          </p>
        )}
      </div>

      <ProductForm
        mode="edit"
        categories={categories}
        initialValues={initialValues}
        submitting={update.isPending}
        deleting={removeProduct.isPending}
        productId={id}
        sellerOffersExpress={offersExpress}
        onSubmit={(payload, ctx) => update.mutate({ payload, variants: ctx.variants })}
        onDelete={async () => {
          const ok = await confirmDialog({
            title: 'Eliminare il prodotto?',
            message: `"${product.name as string}" verrà rimosso dal tuo catalogo. L'azione è irreversibile.`,
            confirmLabel: 'Sì, elimina',
            danger: true,
            icon: Trash2,
          });
          if (ok) removeProduct.mutate();
        }}
      />
    </div>
  );
}

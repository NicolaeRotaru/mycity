'use client';

import { Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import ProductForm, { type ProductInitialValues, type ProductPayload } from '@/components/seller/ProductForm';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { trackProductPublished } from '@/lib/analytics/events';
import { loadAutosave, clearAutosave } from '@/lib/hooks/useFormAutosave';
import { modeToExpressEnabled, type ExpressMode } from '@/lib/products/express';
import type { ProductUnit, ProductCondition } from '@/lib/products/schema';

const AUTOSAVE_KEY = 'mc_new_product_draft';

type Category = { id: string; name: string; slug: string; parent_id: string | null };

type Snapshot = {
  name?: string;
  description?: string;
  price?: number | string;
  compareAtPrice?: number | string;
  stock?: number | string;
  category_id?: string;
  imageUrls?: string[];
  attributes?: Record<string, unknown>;
  tags?: string[];
  unit?: ProductUnit;
  condition?: ProductCondition | '';
  expressMode?: ExpressMode;
  unlimitedStock?: boolean;
};

function snapshotToInitial(s: Snapshot): ProductInitialValues | undefined {
  // Ripristina solo se c'è contenuto significativo.
  if (!s || (!s.name && !s.description && !(s.imageUrls?.length))) return undefined;
  return {
    name: s.name ?? '',
    description: s.description ?? '',
    price: s.price ?? undefined,
    compareAtPrice: s.compareAtPrice ?? undefined,
    unit: s.unit ?? 'pezzo',
    condition: (s.condition || null) as ProductCondition | null,
    stock: s.unlimitedStock ? null : (s.stock != null && s.stock !== '' ? Number(s.stock) : undefined),
    category_id: s.category_id ?? '',
    images: Array.isArray(s.imageUrls) ? s.imageUrls : [],
    attributes: s.attributes ?? {},
    tags: Array.isArray(s.tags) ? s.tags : [],
    expressEnabled: modeToExpressEnabled(s.expressMode ?? 'inherit'),
    status: 'available',
  };
}

function NewProductInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromId = searchParams.get('from');

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

  const { data: offersExpress = false } = useQuery({
    queryKey: [...queryKeys.seller.profile, 'offers-express'],
    queryFn: async (): Promise<boolean> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data } = await supabase.from('profiles').select('offers_express').eq('id', user.id).single();
      return Boolean((data as { offers_express?: boolean } | null)?.offers_express);
    },
  });

  // Duplica: precarica da un prodotto esistente (?from=ID).
  const { data: source, isLoading: loadingSource } = useQuery({
    queryKey: ['duplicate-source', fromId],
    enabled: !!fromId,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('products')
        .select('name, description, price, compare_at_price, unit, condition, stock, category_id, images, attributes, tags, express_enabled, seller_id')
        .eq('id', fromId)
        .single();
      if (error) throw error;
      if ((data as { seller_id?: string }).seller_id && (data as { seller_id?: string }).seller_id !== user.id) {
        throw new Error('Non puoi duplicare un prodotto che non è tuo');
      }
      return data as Record<string, unknown>;
    },
  });

  const initialValues: ProductInitialValues | undefined = useMemo(() => {
    if (fromId) {
      if (!source) return undefined;
      const s = source;
      return {
        name: s.name ? `${s.name as string} (copia)` : '',
        description: (s.description as string) ?? '',
        price: (s.price as number) ?? undefined,
        compareAtPrice: (s.compare_at_price as number) ?? undefined,
        unit: ((s.unit as ProductUnit) ?? 'pezzo'),
        condition: (s.condition as ProductCondition) ?? null,
        stock: (s.stock as number | null) ?? undefined,
        category_id: (s.category_id as string) ?? '',
        images: Array.isArray(s.images) ? (s.images as string[]) : [],
        attributes: (s.attributes as Record<string, unknown>) ?? {},
        tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
        expressEnabled: (s.express_enabled as boolean | null) ?? null,
        status: 'draft',
      };
    }
    return snapshotToInitial(loadAutosave<Snapshot>(AUTOSAVE_KEY) ?? {});
  }, [fromId, source]);

  const create = useMutation({
    mutationFn: async ({ payload }: { payload: ProductPayload }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('products')
        .insert({ ...payload, seller_id: user.id })
        .select('id')
        .single();
      if (error) throw error;
      return { id: data.id as string, sellerId: user.id, status: payload.status };
    },
    onSuccess: ({ id, sellerId, status }) => {
      clearAutosave(AUTOSAVE_KEY);
      if (status === 'available') trackProductPublished(id, sellerId);
      toast.success(status === 'draft' ? 'Bozza salvata' : 'Prodotto pubblicato!');
      router.push('/seller/products');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">{fromId ? 'Duplica prodotto' : 'Nuovo prodotto'}</h1>

      {fromId && loadingSource ? (
        <LoadingState />
      ) : (
        <ProductForm
          mode="create"
          categories={categories}
          initialValues={initialValues}
          submitting={create.isPending}
          sellerOffersExpress={offersExpress}
          autosaveKey={fromId ? undefined : AUTOSAVE_KEY}
          onSubmit={(payload) => create.mutate({ payload })}
        />
      )}
    </div>
  );
}

export default function NewProductPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <NewProductInner />
    </Suspense>
  );
}

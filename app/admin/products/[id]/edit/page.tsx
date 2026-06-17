'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { AlertTriangle, Trash2 } from 'lucide-react';
import ProductForm, { type ProductInitialValues, type ProductPayload } from '@/components/seller/ProductForm';
import ExternalDataPanel from '@/components/admin/ExternalDataPanel';
import { confirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { normalizeCondition, type ProductCondition, type ProductUnit } from '@/lib/products/schema';
import { type ProductVariant } from '@/lib/products/variants';
import { loadProductVariants } from '@/lib/products/persistVariants';
import type { ExternalData } from '@/lib/products/externalSyncShared';

type Category = { id: string; name: string; slug: string; parent_id: string | null };

export default function AdminEditProductPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const qc = useQueryClient();

  const { data: product, isLoading, error } = useQuery({
    queryKey: queryKeys.admin.product(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, description, price, compare_at_price, unit, condition, stock, category_id, images, attributes, tags, express_enabled, seller_id, status, external_source_url, external_marketplace, external_data, external_synced_at')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as Record<string, unknown>;
    },
  });

  const { data: variants = [], isLoading: variantsLoading } = useQuery({
    queryKey: [...queryKeys.admin.product(id), 'variants'],
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

  const update = useMutation({
    mutationFn: async ({ payload, variants: nextVariants }: { payload: ProductPayload; variants: ProductVariant[] }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/products', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ id, ...payload, variants: nextVariants }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? 'Salvataggio non riuscito');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.products });
      qc.invalidateQueries({ queryKey: queryKeys.admin.product(id) });
      qc.invalidateQueries({ queryKey: queryKeys.products.detail(id) });
      toast.success('Modifiche salvate');
      router.push('/admin/products');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const removeProduct = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.products });
      toast.success('Prodotto eliminato');
      router.push('/admin/products');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (isLoading || variantsLoading) return <LoadingState />;
  if (error || !product) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-900 max-w-2xl">
        <p className="font-bold mb-1 flex items-center gap-1.5"><AlertTriangle size={16} aria-hidden /> Errore</p>
        <p className="text-sm mb-3">{error instanceof Error ? error.message : 'Prodotto non trovato'}</p>
        <Link href="/admin/products" className="text-sm font-semibold text-rose-700 hover:underline">← Torna ai prodotti</Link>
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

  const externalSourceUrl = (product.external_source_url as string | null) ?? null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/admin/products" className="text-sm text-primary-700 hover:underline">← Prodotti</Link>
        <h1 className="text-2xl font-bold mt-1">Modifica prodotto</h1>
      </div>

      {externalSourceUrl && (
        <ExternalDataPanel
          productId={id}
          marketplace={(product.external_marketplace as string | null) ?? null}
          sourceUrl={externalSourceUrl}
          syncedAt={(product.external_synced_at as string | null) ?? null}
          external={(product.external_data as ExternalData | null) ?? null}
          onRefreshed={() => qc.invalidateQueries({ queryKey: queryKeys.admin.product(id) })}
        />
      )}

      <ProductForm
        mode="edit"
        categories={categories}
        initialValues={initialValues}
        submitting={update.isPending}
        deleting={removeProduct.isPending}
        productId={id}
        onSubmit={(payload, ctx) => update.mutate({ payload, variants: ctx.variants })}
        onDelete={async () => {
          const ok = await confirmDialog({
            title: 'Eliminare il prodotto?',
            message: `"${product.name as string}" verrà rimosso definitivamente.`,
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

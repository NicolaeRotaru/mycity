'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import ProductForm, { type ProductInitialValues, type ProductPayload } from '@/components/seller/ProductForm';
import ImportFromUrlBox, { type ImportResult } from '@/components/products/ImportFromUrlBox';
import { Select } from '@/components/ui/Field';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { MYCITY_SELLER_ID } from '@/lib/products/mycitySeller';
import { type ProductVariant } from '@/lib/products/variants';

type Category = { id: string; name: string; slug: string; parent_id: string | null };
type SellerOption = { id: string; store_name: string | null; offers_express: boolean | null };

export default function AdminNewProductPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [sellerId, setSellerId] = useState<string>(MYCITY_SELLER_ID);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [importNonce, setImportNonce] = useState(0);

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories.form,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase.from('categories').select('id, name, slug, parent_id').order('name');
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });

  const { data: sellers = [], isLoading: sellersLoading } = useQuery({
    queryKey: queryKeys.admin.sellersForm,
    queryFn: async (): Promise<SellerOption[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, store_name, offers_express')
        .eq('role', 'seller')
        .order('store_name');
      if (error) throw error;
      return (data ?? []) as SellerOption[];
    },
  });

  const sellerOffersExpress = useMemo(
    () => Boolean(sellers.find((s) => s.id === sellerId)?.offers_express),
    [sellers, sellerId],
  );

  const initialValues: ProductInitialValues | undefined = useMemo(() => {
    if (!imported) return undefined;
    return {
      name: imported.name,
      description: imported.description,
      price: imported.suggested_price ?? undefined,
      unit: 'pezzo',
      condition: null,
      stock: 1,
      category_id: imported.subcategory_id ?? imported.category_id ?? '',
      images: imported.image_urls,
      attributes: imported.attributes,
      tags: imported.tags,
      expressEnabled: null,
      status: 'available',
    };
  }, [imported]);

  const create = useMutation({
    mutationFn: async ({ payload, variants }: { payload: ProductPayload; variants: ProductVariant[] }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const external = imported
        ? {
            external_source_url: imported.external.source_url,
            external_marketplace: imported.external.marketplace,
            external_data: {
              price: imported.external.price,
              currency: imported.external.currency,
              delivery_min_days: imported.external.delivery_min_days,
              delivery_max_days: imported.external.delivery_max_days,
              delivery_label: imported.external.delivery_label,
              availability: imported.external.availability,
              source_title: imported.external.source_title,
              fetched_at: imported.external.fetched_at,
            },
          }
        : {};
      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ ...payload, seller_id: sellerId, variants, ...external }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? 'Creazione non riuscita');
      return body.data.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.products });
      qc.invalidateQueries({ queryKey: queryKeys.admin.stats });
      toast.success('Prodotto creato');
      router.push('/admin/products');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/admin/products" className="text-sm text-primary-700 hover:underline">← Prodotti</Link>
        <h1 className="text-2xl font-bold mt-1">Nuovo prodotto</h1>
        <p className="text-sm text-ink-500">Inserisci un prodotto in un negozio qualsiasi, anche importandolo da un marketplace.</p>
      </div>

      <Select
        label="Negozio di destinazione"
        value={sellerId}
        onChange={(e) => setSellerId(e.target.value)}
        disabled={sellersLoading}
      >
        {sellers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.store_name || (s.id === MYCITY_SELLER_ID ? 'MyCity' : s.id.slice(0, 8))}
          </option>
        ))}
      </Select>

      <ImportFromUrlBox
        sellerId={sellerId}
        onImported={(data) => {
          setImported(data);
          setImportNonce((n) => n + 1);
        }}
      />

      <ProductForm
        key={importNonce}
        mode="create"
        categories={categories}
        initialValues={initialValues}
        submitting={create.isPending}
        sellerOffersExpress={sellerOffersExpress}
        onSubmit={(payload, ctx) => create.mutate({ payload, variants: ctx.variants })}
        onDiscard={() => router.push('/admin/products')}
      />
    </div>
  );
}

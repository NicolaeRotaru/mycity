'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import ProductForm, { type ProductInitialValues, type ProductPayload } from '@/components/seller/ProductForm';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import ImportFromUrlBox, { type ImportResult } from '@/components/products/ImportFromUrlBox';
import BulkPhotoCreate from '@/components/seller/BulkPhotoCreate';
import { confirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { trackProductPublished } from '@/lib/analytics/events';
import { loadAutosave, clearAutosave } from '@/lib/hooks/useFormAutosave';
import type { ProductUnit, ProductCondition } from '@/lib/products/schema';
import { type ProductVariant } from '@/lib/products/variants';
import { saveProductVariants, loadProductVariants } from '@/lib/products/persistVariants';

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
  fastDelivery?: boolean;
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
    expressEnabled: s.fastDelivery ?? null,
    status: 'available',
  };
}

function NewProductInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromId = searchParams.get('from');
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [importNonce, setImportNonce] = useState(0);

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

  // Duplica: carica anche le varianti del prodotto sorgente (id azzerati → nuove).
  const { data: sourceVariants = [] } = useQuery({
    queryKey: ['duplicate-variants', fromId],
    enabled: !!fromId,
    queryFn: () => loadProductVariants(fromId!),
  });

  const initialValues: ProductInitialValues | undefined = useMemo(() => {
    if (imported) {
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
    }
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
        variants: sourceVariants.map((v) => ({ ...v, id: undefined })),
      };
    }
    return snapshotToInitial(loadAutosave<Snapshot>(AUTOSAVE_KEY) ?? {});
  }, [imported, fromId, source, sourceVariants]);

  const create = useMutation({
    mutationFn: async ({ payload, variants }: { payload: ProductPayload; variants: ProductVariant[] }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
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
            external_synced_at: new Date().toISOString(),
          }
        : {};
      const { data, error } = await supabase
        .from('products')
        .insert({ ...payload, seller_id: user.id, ...external })
        .select('id')
        .single();
      if (error) throw error;
      if (variants.length > 0) await saveProductVariants(data.id as string, variants);
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
      <SellerPageTitle
        eyebrow="Catalogo"
        title={fromId ? 'Duplica prodotto' : 'Nuovo prodotto'}
        sub={fromId
          ? 'Parti da una copia e modifica quello che serve.'
          : 'Compila la scheda — o lascia che l\'AI la prepari per te da foto, voce o link.'}
        className="mb-0"
      />

      {!fromId && (
        <>
          <BulkPhotoCreate onCreated={() => router.push('/seller/products')} />
          <ImportFromUrlBox
            onImported={(data) => {
              setImported(data);
              setImportNonce((n) => n + 1);
            }}
          />
        </>
      )}

      {fromId && loadingSource ? (
        <LoadingState />
      ) : (
        <ProductForm
          key={importNonce}
          mode="create"
          categories={categories}
          initialValues={initialValues}
          submitting={create.isPending}
          sellerOffersExpress={offersExpress}
          autosaveKey={fromId ? undefined : AUTOSAVE_KEY}
          onSubmit={(payload, ctx) => create.mutate({ payload, variants: ctx.variants })}
          onDiscard={async () => {
            const ok = await confirmDialog({
              title: 'Eliminare questo prodotto?',
              message: 'I dati inseriti per questo nuovo prodotto verranno persi.',
              confirmLabel: 'Sì, elimina',
              danger: true,
              icon: Trash2,
            });
            if (!ok) return;
            clearAutosave(AUTOSAVE_KEY);
            router.push('/seller/products');
          }}
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

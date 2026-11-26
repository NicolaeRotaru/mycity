'use client';

import { use, useState } from 'react';
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

const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Category = { id: string; name: string; slug: string; parent_id: string | null };

/**
 * R03-008 — IL MODULO APERTO RESTA APERTO, CON I DATI CON CUI SI È APERTO (come nella pagina del
 * negozio). Aperta la pagina senza rete (riga e taglie in memoria), al ritorno della rete le letture
 * ripartivano e il caricamento prendeva il posto del modulo: il modulo si smontava e le modifiche
 * scritte sparivano. Una volta aperto, il modulo non si smonta più; si rimonta solo quando lo chiede
 * una scorta cambiata (sotto, con la riga e le taglie appena rilette).
 */
type Apertura = { id: string; riga: Record<string, unknown>; taglie: ProductVariant[] };

export default function AdminEditProductPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const qc = useQueryClient();
  // 5/11/2026 (S05) — Dopo «la scorta è cambiata» il modulo si rimonta coi dati
  // riletti: la scorta vista all'apertura la tiene il modulo, e senza rimontarlo
  // ogni nuovo «Salva» ridava lo stesso errore finché non si usciva.
  const [versioneModulo, setVersioneModulo] = useState(0);
  const [apertura, setApertura] = useState<Apertura | null>(null);

  const { data: product, isLoading, error, refetch: rileggiProdotto, isFetching: prodottoInLettura, isFetchedAfterMount: prodottoRiletto, fetchStatus: prodottoFetchStatus } = useQuery({
    queryKey: queryKeys.admin.product(id),
    queryFn: async () => {
      // R22-017 — Un id che non ha la forma di un codice non è un guasto: il prodotto non c'è.
      if (!FORMA_UUID.test(id)) return null;
      const { data, error } = await supabase
        .from('products')
        .select('id, name, description, price, compare_at_price, unit, condition, stock, category_id, images, attributes, tags, express_enabled, seller_id, status, external_source_url, external_marketplace, external_data, external_synced_at')
        .eq('id', id)
        .maybeSingle();
      // R22-017 — Con maybeSingle la riga mancante è «nessun errore, nessuna riga» (non trovato);
      // un errore vero resta un errore e la pagina dice che la lettura non è riuscita.
      if (error) throw error;
      return (data ?? null) as Record<string, unknown> | null;
    },
    // 31/10/2026 — IL MODULO SI APRE SOLO CON LA SCORTA DELLA BANCA DATI.
    // Il modulo tiene la scorta vista all'apertura e la manda accanto a quella
    // nuova: se partisse dalla copia in memoria (letta minuti prima, prima di
    // una vendita) ogni «Salva» direbbe «la scorta e' cambiata», anche dopo
    // aver riaperto il prodotto come chiede il messaggio. Si rilegge sempre,
    // e il modulo aspetta che quella lettura finisca (sotto, prima del modulo).
    refetchOnMount: 'always',
  });

  const { data: variantiLette, error: erroreVarianti, isLoading: variantsLoading, isFetching: varianteInLettura, isFetchedAfterMount: variantiRilette, refetch: rileggiVarianti, fetchStatus: variantiFetchStatus } = useQuery({
    queryKey: [...queryKeys.admin.product(id), 'variants'],
    queryFn: () => loadProductVariants(id),
    // R22-017 — Con un id che non ha la forma di un codice il database risponderebbe con un errore di
    // sintassi e la pagina parlerebbe di taglie: non si legge, la pagina dice «Prodotto non trovato».
    enabled: FORMA_UUID.test(id),
    refetchOnMount: 'always',
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
    mutationFn: async ({
      payload,
      variants: nextVariants,
      scorteViste,
    }: {
      payload: ProductPayload;
      variants: ProductVariant[];
      scorteViste: Record<string, number>;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/products', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        // 31/10/2026 — con le scorte viste all'apertura: una variante venduta
        // mentre la scheda era aperta non torna in vetrina (la rotta le passa a
        // chi salva le varianti, che riscrive solo quelle cambiate a mano).
        body: JSON.stringify({ id, ...payload, variants: nextVariants, scorteViste }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const errore = new Error(body?.error?.message ?? 'Salvataggio non riuscito') as Error & { conflitto?: boolean };
        errore.conflitto = res.status === 409;
        throw errore;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.products });
      qc.invalidateQueries({ queryKey: queryKeys.admin.product(id) });
      qc.invalidateQueries({ queryKey: queryKeys.products.detail(id) });
      toast.success('Modifiche salvate');
      router.push('/admin/products');
    },
    onError: async (err: unknown) => {
      if ((err as { conflitto?: boolean })?.conflitto) {
        // La chiave del prodotto è anche il prefisso di quella delle varianti: si rileggono tutte e due.
        await qc.invalidateQueries({ queryKey: queryKeys.admin.product(id) });
        // R03-008 — Il modulo si rimonta con la riga e le taglie appena rilette, non con quelle dell'apertura.
        const riga = qc.getQueryData<Record<string, unknown> | null>(queryKeys.admin.product(id));
        const taglie = qc.getQueryData<ProductVariant[]>([...queryKeys.admin.product(id), 'variants']);
        if (riga && taglie) setApertura({ id, riga, taglie });
        setVersioneModulo((v) => v + 1);
        toast.error('Qualcosa è cambiato mentre la scheda era aperta (scorta o varianti): ho riletto il prodotto. Controlla i numeri e salva di nuovo.', { duration: 10_000 });
        return;
      }
      toast.error(friendlyError(err));
    },
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

  // R03-008 — Senza rete la lettura va in pausa (senza dati, ne' caricamento ne' errore): non e'
  // «Prodotto non trovato» e non e' un modulo con zero taglie. Una query spenta non e' in pausa.
  const prodottoInPausa = product === undefined && prodottoFetchStatus === 'paused';
  const taglieInPausa = variantiLette === undefined && variantiFetchStatus === 'paused';
  const giaAperto = apertura !== null && apertura.id === id ? apertura : null;
  // Il caricamento e gli avvisi al posto del modulo valgono solo finche' il modulo non si e' aperto:
  // dopo, quando la rete torna e le letture ripartono, il modulo resta dov'e'.
  if (!giaAperto) {
    if (isLoading || variantsLoading || (prodottoInLettura && !prodottoRiletto) || (varianteInLettura && !variantiRilette)) return <LoadingState />;
    // 31/10/2026 — SENZA LE VARIANTI IL MODULO NON SI APRE. Se la lettura delle
    // taglie cade, le taglie non ci sono e il modulo partiva senza taglie: al «Salva»
    // la PATCH le riceveva vuote. Come nella pagina del negozio, si ferma e lo dice.
    if (error || erroreVarianti || prodottoInPausa || taglieInPausa || !product) {
      const prodottoNonLetto = Boolean(error) || prodottoInPausa;
      return (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-900 max-w-2xl">
          <p className="font-bold mb-1 flex items-center gap-1.5"><AlertTriangle size={16} aria-hidden /> Errore</p>
          <p className="text-sm mb-3">
            {prodottoNonLetto
              ? 'Non riesco a leggere questo prodotto. Non vuol dire che non esista: vuol dire che non l’ho potuto guardare. Riprova fra un momento.'
              : erroreVarianti || taglieInPausa
                ? 'Non riesco a leggere le taglie e le varianti di questo prodotto. Ricarica la pagina prima di modificarlo: salvando adesso le varianti andrebbero perse.'
                : 'Prodotto non trovato'}
          </p>
          {/* R03-007 — Riprova anche quando a cadere sono le varianti: rilegge quelle (e il prodotto, se è caduto lui). */}
          {(prodottoNonLetto || erroreVarianti || taglieInPausa) && (
            <button type="button" onClick={() => { if (prodottoNonLetto) void rileggiProdotto(); if (erroreVarianti || taglieInPausa) void rileggiVarianti(); }} className="mr-4 text-sm font-semibold text-rose-700 hover:underline">
              Riprova
            </button>
          )}
          <Link href="/admin/products" className="text-sm font-semibold text-rose-700 hover:underline">← Torna ai prodotti</Link>
        </div>
      );
    }
  }

  // Il modulo si apre adesso (e da qui in poi resta), oppure e' gia' aperto: con i dati dell'apertura.
  const modulo: Apertura = giaAperto ?? { id, riga: product as Record<string, unknown>, taglie: variantiLette as ProductVariant[] };
  if (!giaAperto) setApertura(modulo);
  const variants = modulo.taglie;
  const rigaViva = (product as Record<string, unknown> | null | undefined) ?? modulo.riga;

  const attrs = (modulo.riga.attributes as Record<string, unknown>) ?? {};
  const legacyStato = typeof attrs.stato === 'string' ? attrs.stato : '';
  const initialValues: ProductInitialValues = {
    name: (modulo.riga.name as string) ?? '',
    description: (modulo.riga.description as string) ?? '',
    price: (modulo.riga.price as number) ?? undefined,
    compareAtPrice: (modulo.riga.compare_at_price as number) ?? undefined,
    unit: ((modulo.riga.unit as ProductUnit) ?? 'pezzo'),
    condition: ((modulo.riga.condition as ProductCondition) ?? (normalizeCondition(legacyStato) || null)),
    stock: (modulo.riga.stock as number | null) ?? null,
    category_id: (modulo.riga.category_id as string) ?? '',
    images: Array.isArray(modulo.riga.images) ? (modulo.riga.images as string[]) : [],
    attributes: attrs,
    tags: Array.isArray(modulo.riga.tags) ? (modulo.riga.tags as string[]) : [],
    expressEnabled: (modulo.riga.express_enabled as boolean | null) ?? null,
    status: (modulo.riga.status as string) ?? 'available',
    variants,
  };

  const externalSourceUrl = (modulo.riga.external_source_url as string | null) ?? null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/admin/products" className="text-sm text-primary-700 hover:underline">← Prodotti</Link>
        <h1 className="text-2xl font-bold mt-1">Modifica prodotto</h1>
      </div>

      {externalSourceUrl && (
        <ExternalDataPanel
          productId={id}
          marketplace={(rigaViva.external_marketplace as string | null) ?? null}
          sourceUrl={externalSourceUrl}
          syncedAt={(rigaViva.external_synced_at as string | null) ?? null}
          external={(rigaViva.external_data as ExternalData | null) ?? null}
          onRefreshed={() => qc.invalidateQueries({ queryKey: queryKeys.admin.product(id) })}
        />
      )}

      <ProductForm
        key={versioneModulo}
        mode="edit"
        categories={categories}
        initialValues={initialValues}
        submitting={update.isPending}
        deleting={removeProduct.isPending}
        productId={id}
        onSubmit={(payload, ctx) => update.mutate({ payload, variants: ctx.variants, scorteViste: ctx.scorteViste })}
        onDelete={async () => {
          const ok = await confirmDialog({
            title: 'Eliminare il prodotto?',
            message: `"${modulo.riga.name as string}" verrà rimosso definitivamente.`,
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

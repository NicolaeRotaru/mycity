'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import caricatoreFotoRemote from '@/lib/image-loader';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw, ShoppingBasket } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { formatPrice } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { riordina } from '@/lib/riordino';
import { conNegozioDellOrdine } from '@/lib/queries/negozio-dell-ordine';

/**
 * "Ordina di nuovo" — rail di riordino rapido nella home, derivata dagli ordini
 * reali del buyer autenticato (nessuna colonna nuova). Mostra:
 *  - un'eyebrow "Bentornato/a, {nome}" + titolo serif;
 *  - una card "Quello che compri spesso" con i prodotti presi in almeno due
 *    ordini recenti (staple), ricomprabili in un click;
 *  - gli ultimi 3 ordini NON annullati, con thumb dei prodotti e azioni
 *    "Riordina" (carica il carrello) / "Dettagli".
 *
 * SELF-HIDES: per gli ospiti (non loggati) o con zero ordini → ritorna null,
 * così la sezione sparisce del tutto dal motore della home. Nessun dato finto.
 */

type OrderLine = {
  product_id: string | null;
  variant_id?: string | null;
  variant_label?: string | null;
  quantity: number;
  unit_price: number | string;
  products: { name: string | null; images: string[] | null } | null;
};

type RecentOrder = {
  id: string;
  created_at: string;
  total_price: number | string;
  seller_id: string | null;
  seller: { store_name: string | null } | null;
  order_items: OrderLine[];
};

type ReorderData = {
  firstName: string | null;
  orders: RecentOrder[];
};

function firstNameOf(full: string | null | undefined): string | null {
  const n = (full ?? '').trim();
  if (!n) return null;
  return n.split(/\s+/)[0];
}

export default function ReorderRail() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['home', 'reorder'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ReorderData | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null; // ospite → self-hide

      const [ordersRes, profileRes] = await Promise.all([
        supabase
          .from('orders')
          .select(`
            id, created_at, total_price, seller_id,
            order_items ( product_id, variant_id, variant_label, quantity, unit_price, products ( name, images ) )
          `)
          .eq('user_id', user.id)
          .neq('delivery_status', 'CANCELED')
          .order('created_at', { ascending: false })
          .limit(6),
        supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
      ]);

      const righe = (ordersRes.data ?? []) as unknown as Array<Omit<RecentOrder, 'seller'>>;
      if (righe.length === 0) return null; // zero ordini → self-hide
      // 18/10/2026 — Il nome del negozio dalla vetrina pubblica, non da `profiles`
      // (lib/queries/negozio-dell-ordine.ts): regge anche quando `profiles` si chiude.
      const orders = (await conNegozioDellOrdine(supabase, righe, 'id, store_name')) as RecentOrder[];

      const firstName = firstNameOf((profileRes.data as { full_name: string | null } | null)?.full_name);
      return { firstName, orders };
    },
  });

  /**
   * 5/11/2026 — «PRODOTTI CHE COMPRI SPESSO» VUOL DIRE COMPRATI PIÙ DI UNA VOLTA.
   * Prima entrava tutto quello degli ultimi sei ordini, anche una cosa sola comprata una volta,
   * col titolo «La tua spesa della settimana» e un totale ai prezzi di allora (poi il carrello,
   * che rilegge i prezzi di oggi, diceva un'altra cifra). Adesso conta in quanti ORDINI compare
   * (stessa variante), tiene solo quelli presenti in almeno due, e la cifra non c'è più.
   */
  const staples = useMemo(() => {
    if (!data) return [];
    const byProduct = new Map<string, {
      id: string; name: string; image: string | null; price: number; freq: number;
      sellerId: string | null; variantId: string | null; variantLabel: string | null;
    }>();
    for (const o of data.orders) {
      const visti = new Set<string>();
      for (const it of o.order_items ?? []) {
        if (!it.product_id || !it.products?.name) continue;
        const chiave = `${it.product_id}|${it.variant_id ?? ''}`;
        if (visti.has(chiave)) continue;
        visti.add(chiave);
        const prev = byProduct.get(chiave);
        if (prev) {
          prev.freq += 1;
        } else {
          byProduct.set(chiave, {
            id: it.product_id,
            name: it.products.name,
            image: it.products.images?.[0] ?? null,
            price: Number(it.unit_price),
            freq: 1,
            sellerId: o.seller_id,
            variantId: it.variant_id ?? null,
            variantLabel: it.variant_label ?? null,
          });
        }
      }
    }
    return [...byProduct.values()].filter((p) => p.freq >= 2).sort((a, b) => b.freq - a.freq).slice(0, 6);
  }, [data]);

  if (!data) return null;

  const recent = data.orders.slice(0, 3);
  const greeting = data.firstName ? `Bentornato/a, ${data.firstName}` : 'Bentornato/a';

  // #113 — Stessa funzione degli altri due punti: chiede prima di svuotare il
  // carrello e rilegge i prezzi di adesso.
  const reorderItems = async (order: RecentOrder) => {
    const aggiunti = await riordina(
      (order.order_items ?? []).map((it) => ({
        productId: it.product_id ?? '',
        name: it.products?.name ?? '',
        prezzoStorico: Number(it.unit_price),
        image: it.products?.images?.[0],
        quantity: it.quantity,
        // 5/11/2026 — Il negozio e la variante, come gli altri due «Riordina»: senza il negozio
        // il carrello raggruppava per nome, senza la variante la cassa bloccava l'ordine.
        sellerId: order.seller_id ?? undefined,
        storeName: order.seller?.store_name ?? undefined,
        variantId: it.variant_id ?? undefined,
        variantLabel: it.variant_label ?? undefined,
      })),
    );
    if (aggiunti > 0) router.push('/cart');
  };

  const reorderStaples = async () => {
    const aggiunti = await riordina(
      staples.map((p) => ({
        productId: p.id,
        name: p.name,
        prezzoStorico: p.price,
        image: p.image ?? undefined,
        quantity: 1,
        sellerId: p.sellerId ?? undefined,
        variantId: p.variantId ?? undefined,
        variantLabel: p.variantLabel ?? undefined,
      })),
    );
    if (aggiunti > 0) router.push('/cart');
  };

  return (
    <section className="bg-primary-50 border-y border-cream-300">
      <div className="container mx-auto px-4 sm:px-6 py-6">
        <div className="mb-4">
          <span className="inline-flex items-center gap-1.5 text-primary-700 text-xs font-bold uppercase tracking-wider">
            <RotateCcw size={14} strokeWidth={2.4} aria-hidden />
            {greeting}
          </span>
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mt-1">Ordina di nuovo</h2>
        </div>

        {/* Quello che compri spesso: visibile solo con >= 3 prodotti presi in almeno due ordini */}
        {staples.length >= 3 && (
          <div className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border border-primary-200 bg-white p-4 shadow-warm">
            <div className="min-w-[180px] flex-1">
              <p className="inline-flex items-center gap-2 font-bold text-ink-900">
                <ShoppingBasket size={18} strokeWidth={2.2} className="text-primary-700" aria-hidden />
                Quello che compri spesso
              </p>
              <p className="mt-1 text-[13px] text-ink-500">
                {staples.length} prodotti che hai preso in più di un ordine
              </p>
            </div>
            <div className="flex gap-1.5">
              {staples.slice(0, 5).map((p) => (
                <div key={p.id} className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md border border-cream-200 bg-cream-100">
                  {p.image && (
                    <Image src={sizedImage(p.image, 'thumb')} alt={p.name} fill sizes="44px" loader={caricatoreFotoRemote} className="object-cover" />
                  )}
                </div>
              ))}
            </div>
            <Button size="sm" icon={RotateCcw} onClick={reorderStaples}>
              Ricomprali tutti
            </Button>
          </div>
        )}

        {/* Ordini recenti 3-up */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {recent.map((o) => {
            const lines = (o.order_items ?? []).filter((l) => l.product_id && l.products?.name);
            const thumbs = lines.slice(0, 4);
            const names = lines.map((l) => l.products?.name).filter(Boolean).join(', ');
            return (
              <div key={o.id} className="flex flex-col gap-3 rounded-2xl border border-cream-300 bg-white p-3.5 shadow-warm">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-bold text-ink-900">{o.seller?.store_name ?? 'Negozio'}</p>
                  <span className="shrink-0 whitespace-nowrap text-xs text-ink-400">
                    {new Date(o.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {thumbs.map((l, i) => {
                    const img = l.products?.images?.[0];
                    return (
                      <div key={`${o.id}-${i}`} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-cream-100">
                        {img && <Image src={sizedImage(img, 'thumb')} alt="" fill sizes="48px" loader={caricatoreFotoRemote} className="object-cover" />}
                      </div>
                    );
                  })}
                  <span className="min-w-0 flex-1 self-center truncate text-xs text-ink-500">{names}</span>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Button size="sm" icon={RotateCcw} onClick={() => reorderItems(o)}>
                    Riordina
                  </Button>
                  <Link href={`/orders/${o.id}`} className="px-2 py-2 text-[13px] font-semibold text-ink-500 hover:text-ink-900">
                    Dettagli
                  </Link>
                  <span className="ml-auto text-sm font-bold text-ink-900">{formatPrice(Number(o.total_price))}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingCart, ArrowRight, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { addToCart, type CartItem } from '@/lib/cart';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { toast } from 'sonner';

/**
 * /shared-cart — pagina destinazione del ShareCartButton.
 *
 * Esperti consultati:
 * - Senior PM: "WhatsApp share = canale #1 word-of-mouth in Italia.
 *   La pagina deve renderizzare in <2s su 4G, no checkout, solo conferma."
 * - UX Designer: "Preview prodotti + 1 CTA chiaro 'Aggiungi al carrello'.
 *   No password wall, no signup obbligato (puoi comprare anche dopo)."
 * - Security: "Querystring puo' contenere fino a 50 item — limite anti-DOS."
 *
 * Format URL: /shared-cart?cart=id1:qty1,id2:qty2,...
 * Parser robusto: ignora entry malformate, limita a 50 prodotti.
 */

type Product = {
  id: string;
  name: string;
  price: number;
  images: string[] | null;
  status: string;
  stock: number | null;
  profiles: { store_name: string | null } | null;
};

type ParsedItem = { id: string; quantity: number };

const MAX_ITEMS = 50;

function parseCartParam(raw: string | null): ParsedItem[] {
  if (!raw) return [];
  return raw
    .split(',')
    .slice(0, MAX_ITEMS)
    .map((entry) => {
      const [id, qty] = entry.split(':');
      const q = Number(qty);
      if (!id || !Number.isFinite(q) || q < 1 || q > 99) return null;
      // UUID basic validation
      if (!/^[a-f0-9-]{30,40}$/i.test(id)) return null;
      return { id, quantity: q };
    })
    .filter((x): x is ParsedItem => x !== null);
}

function SharedCartInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cartParam = searchParams.get('cart');

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [addedAll, setAddedAll] = useState(false);

  const parsed = parseCartParam(cartParam);

  useEffect(() => {
    if (parsed.length === 0) {
      setLoading(false);
      return;
    }
    (async () => {
      const ids = parsed.map((p) => p.id);
      const { data } = await supabase
        .from('products')
        .select(`
          id, name, price, images, status, stock,
          profiles!products_seller_id_fkey ( store_name )
        `)
        .in('id', ids);
      setProducts((data ?? []) as unknown as Product[]);
      setLoading(false);
    })();
    // parsed e' derivato da cartParam — re-parsing in deps userebbe nuovo ref ogni render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartParam]);

  if (loading) return <LoadingState message="Carico la lista..." />;

  if (parsed.length === 0) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-12 max-w-xl text-center">
        <ShoppingCart size={48} className="mx-auto text-ink-300 mb-4" strokeWidth={1.5} />
        <h1 className="text-2xl font-serif font-bold text-ink-900 mb-2">Link non valido</h1>
        <p className="text-ink-600 mb-6">
          Il link condiviso e' scaduto o malformato. Apri il marketplace per scoprire i prodotti.
        </p>
        <Button href="/">Vai al marketplace</Button>
      </div>
    );
  }

  const available = products.filter((p) => p.status === 'available');
  const unavailable = parsed.filter((p) => !available.find((a) => a.id === p.id));

  const addAll = () => {
    let count = 0;
    for (const item of parsed) {
      const product = available.find((p) => p.id === item.id);
      if (!product) continue;
      const stock = product.stock ?? Infinity;
      const qty = Math.min(item.quantity, stock);
      if (qty < 1) continue;
      addToCart({
        id: product.id,
        name: product.name,
        price: Number(product.price),
        image: Array.isArray(product.images) ? product.images[0] : undefined,
        quantity: qty,
      });
      count += qty;
    }
    setAddedAll(true);
    toast.success(`${count} articoli aggiunti al carrello`);
    setTimeout(() => router.push('/cart'), 1500);
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-2xl">
      <header className="text-center mb-8">
        <div className="inline-flex items-center gap-2 bg-secondary-100 text-secondary-800 px-3 py-1 rounded-full text-xs font-bold tracking-wide mb-3">
          <ShoppingCart size={14} strokeWidth={2.4} />
          Lista condivisa
        </div>
        <h1 className="text-3xl font-serif font-bold text-ink-900">
          Qualcuno ha pensato a te
        </h1>
        <p className="text-ink-600 mt-2">
          Ecco i prodotti che ti sono stati suggeriti. Aggiungili al tuo carrello con un click.
        </p>
      </header>

      <ul className="space-y-3 mb-6">
        {available.map((p) => {
          const item = parsed.find((x) => x.id === p.id);
          const qty = item?.quantity ?? 1;
          const img = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
          return (
            <li
              key={p.id}
              className="bg-white border border-cream-300 rounded-2xl p-4 flex gap-4 items-center"
            >
              <div className="w-16 h-16 rounded-lg bg-cream-100 flex-shrink-0 overflow-hidden">
                {img ? (
                  <Image
                    src={sizedImage(img, 'thumb')}
                    alt={p.name}
                    width={64}
                    height={64}
                    className="object-cover w-full h-full"
                    unoptimized
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <Link href={`/product/${p.id}`} className="font-semibold text-ink-900 hover:underline">
                  {p.name}
                </Link>
                <p className="text-xs text-ink-500 mt-0.5">
                  {p.profiles?.store_name ?? 'Negozio'} · ×{qty}
                </p>
              </div>
              <span className="font-bold text-ink-900 shrink-0">
                {formatPrice(Number(p.price) * qty)}
              </span>
            </li>
          );
        })}
      </ul>

      {unavailable.length > 0 && (
        <div className="bg-cream-50 border border-cream-300 rounded-xl p-4 text-sm text-ink-600 mb-6">
          ⚠ {unavailable.length} {unavailable.length === 1 ? 'prodotto non disponibile' : 'prodotti non disponibili'} sono stati esclusi dalla lista.
        </div>
      )}

      <div className="flex gap-3">
        <Button
          onClick={addAll}
          disabled={available.length === 0 || addedAll}
          fullWidth
          size="lg"
          icon={addedAll ? Check : ShoppingCart}
          iconRight={addedAll ? undefined : ArrowRight}
        >
          {addedAll ? 'Aggiunti!' : `Aggiungi tutto al carrello`}
        </Button>
      </div>
    </div>
  );
}

export default function SharedCartPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SharedCartInner />
    </Suspense>
  );
}

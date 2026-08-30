'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingCart, ArrowRight, Check, Package, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { addToCart, type CartItem } from '@/lib/cart';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
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
  /**
   * 27/8/2026 (R088) — `seller_id` e `has_variants` non venivano nemmeno chiesti al database.
   * Senza il primo il carrello non sa di che negozio è la merce e mette tutto in un mucchio solo:
   * la consegna e la spedizione si pagano PER NEGOZIO, quindi il totale del carrello usciva più
   * basso di quello della cassa, che il proprietario lo rilegge. Senza il secondo un capo con le
   * taglie entrava nel carrello senza taglia e sbatteva contro «Scegli le opzioni» in cassa.
   */
  seller_id: string | null;
  has_variants: boolean | null;
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
  /**
   * 27/8/2026 (R088) — l'errore della lettura non veniva nemmeno raccolto (`const { data } =
   * await supabase…`). Con la rete caduta la lista restava vuota e la pagina scriveva che TUTTI i
   * prodotti scelti per te non sono disponibili: il regalo sembrava svanito, e non c'era modo di
   * capire che bastava riprovare.
   */
  const [nonLetta, setNonLetta] = useState(false);
  const [tentativo, setTentativo] = useState(0);

  const parsed = parseCartParam(cartParam);

  useEffect(() => {
    if (parsed.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      const ids = parsed.map((p) => p.id);
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, name, price, images, status, stock, seller_id, has_variants,
          profiles!products_seller_id_fkey ( store_name )
        `)
        .in('id', ids);
      setNonLetta(Boolean(error));
      setProducts((error ? [] : (data ?? [])) as unknown as Product[]);
      setLoading(false);
    })();
    // parsed e' derivato da cartParam — re-parsing in deps userebbe nuovo ref ogni render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartParam, tentativo]);

  if (loading) return <LoadingState message="Carico la lista..." />;

  if (nonLetta) {
    return (
      <ErrorState
        title="Non riesco a leggere la lista"
        description="La lettura non è riuscita, quindi non so ancora cosa ti è stato suggerito. I prodotti ci sono: riprova fra un momento."
        onRetry={() => setTentativo((n) => n + 1)}
      />
    );
  }

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

  const inVendita = products.filter((p) => p.status === 'available');
  /**
   * R088 — un prodotto con le taglie NON si può mettere nel carrello da qui: la variante si sceglie
   * sulla sua scheda, e senza variante la cassa lo blocca con «Scegli le opzioni». Non è nemmeno
   * «non disponibile»: è disponibile eccome, va solo scelto. Perciò ha un riquadro suo, col link.
   */
  const daScegliere = inVendita.filter((p) => p.has_variants === true);
  const available = inVendita.filter((p) => p.has_variants !== true);
  const unavailable = parsed.filter((p) => !inVendita.find((a) => a.id === p.id));

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
        // R088 — il negozio viaggia con la riga: senza, il carrello raggruppa tutto sotto un
        // «Negozio» solo e conta una consegna e una spedizione al posto di due.
        sellerId: product.seller_id ?? undefined,
        storeName: product.profiles?.store_name ?? undefined,
      });
      count += qty;
    }
    // R088 — «0 articoli aggiunti al carrello», e un secondo e mezzo dopo il carrello vuoto.
    // Succede quando la merce c'è ma è finita (`stock: 0`): il pulsante è acceso, il ciclo non
    // aggiunge niente. Dirlo è meglio che portare la persona altrove senza spiegazioni.
    if (count === 0) {
      toast.error('Niente da aggiungere: questi prodotti sono finiti');
      return;
    }
    setAddedAll(true);
    toast.success(`${count} ${count === 1 ? 'articolo aggiunto' : 'articoli aggiunti'} al carrello`);
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
                  <div className="w-full h-full flex items-center justify-center"><Package size={24} strokeWidth={2.2} className="text-ink-400" aria-hidden /></div>
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

      {daScegliere.length > 0 && (
        <div className="bg-cream-50 border border-cream-300 rounded-xl p-4 text-sm text-ink-700 mb-6">
          <p className="font-semibold text-ink-900 mb-2">
            {daScegliere.length === 1 ? 'Un prodotto va scelto sulla sua scheda' : 'Alcuni prodotti vanno scelti sulla loro scheda'}
          </p>
          <p className="text-ink-600 mb-3">
            {daScegliere.length === 1 ? 'Ha' : 'Hanno'} taglie o colori da scegliere: apri la scheda, scegli, e finisce nel carrello.
          </p>
          <ul className="space-y-1.5">
            {daScegliere.map((p) => (
              <li key={p.id}>
                <Link href={`/product/${p.id}`} className="font-semibold text-primary-700 hover:underline">
                  {p.name} — scegli le opzioni
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unavailable.length > 0 && (
        <div className="bg-cream-50 border border-cream-300 rounded-xl p-4 text-sm text-ink-600 mb-6 flex items-center gap-1.5">
          <AlertTriangle size={16} strokeWidth={2.2} className="text-accent-500 shrink-0" aria-hidden /> {unavailable.length} {unavailable.length === 1 ? 'prodotto non disponibile' : 'prodotti non disponibili'} sono stati esclusi dalla lista.
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

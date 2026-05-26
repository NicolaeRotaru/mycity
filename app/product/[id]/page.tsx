'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { addToCart } from '@/lib/cart';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { FREE_SHIPPING_THRESHOLD, LOW_STOCK_THRESHOLD } from '@/lib/constants';
import ProductGrid from '@/components/ProductGrid';
import { findLabelForKey, formatAttributeValue } from '@/lib/category-attributes';
import { useFavorites } from '@/components/hooks/useFavorites';
import { useProfile } from '@/components/hooks/useProfile';
import ContactSellerButton from '@/components/ContactSellerButton';
import ProductViewTracker from '@/components/ProductViewTracker';
import ProductQA from '@/components/ProductQA';
import RecentlyViewed from '@/components/RecentlyViewed';
import StickyAddToCart from '@/components/StickyAddToCart';
import SimilarProducts from '@/components/SimilarProducts';
import PriceComparison from '@/components/PriceComparison';
import ActivePromoBadge from '@/components/ActivePromoBadge';
import AddToListButton from '@/components/AddToListButton';
import PhotoReviewUpload from '@/components/PhotoReviewUpload';

export default function ProductPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const qc = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  const [activeImg, setActiveImg] = useState(0);
  const { isAuthenticated, profile } = useProfile();
  const { favorites, toggle: toggleFav } = useFavorites();
  const isFav = favorites.has(id);

  // Form recensione
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewPhotos, setReviewPhotos] = useState<string[]>([]);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select(`
        *, categories ( slug, name ), profiles!products_seller_id_fkey ( id, store_name, is_approved )
      `).eq('id', id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['reviews', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('reviews')
        .select('id, rating, comment, created_at, user_id, photo_urls, verified_purchase').eq('product_id', id)
        .order('verified_purchase', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const submitReview = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/sign-in?returnTo=/product/${id}`);
        throw new Error('REDIRECT');
      }
      // Verified purchase: controlla se l'utente ha un ordine consegnato
      // contenente questo prodotto. Trust & Safety: badge anti-fake reviews.
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('id, orders!inner(user_id, delivery_status)')
        .eq('product_id', id)
        .eq('orders.user_id', user.id)
        .eq('orders.delivery_status', 'DELIVERED')
        .limit(1);
      const verified = (orderItems?.length ?? 0) > 0;

      const { error } = await supabase.from('reviews').insert({
        product_id: id,
        user_id: user.id,
        rating: reviewRating,
        comment: reviewComment.trim() || null,
        photo_urls: reviewPhotos.length > 0 ? reviewPhotos : null,
        verified_purchase: verified,
      });
      if (error) throw error;

      // Bonus loyalty per recensione con foto (CRM Manager: +engagement).
      // Best-effort: se la RPC non esiste (migration 027 non applicata), ignora.
      if (reviewPhotos.length > 0) {
        try {
          await supabase.rpc('award_loyalty_points', {
            p_user: user.id,
            p_delta: 20,
            p_reason: 'review_with_photo',
            p_order: null,
          });
        } catch { /* noop */ }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews', id] });
      setReviewComment('');
      setReviewRating(5);
      setReviewPhotos([]);
      toast.success(
        reviewPhotos.length > 0
          ? `Grazie! Recensione pubblicata · +20 punti loyalty per le foto 🎉`
          : 'Grazie per la recensione!'
      );
    },
    onError: (err: any) => {
      if (err?.message !== 'REDIRECT') toast.error(err.message ?? 'Errore');
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-pulse">
          <div className="bg-cream-200 h-96 rounded-xl" />
          <div className="space-y-3">
            <div className="h-6 bg-cream-200 rounded w-3/4" />
            <div className="h-4 bg-cream-100 rounded w-1/2" />
            <div className="h-10 bg-cream-200 rounded w-1/3" />
            <div className="h-24 bg-cream-100 rounded" />
            <div className="h-12 bg-cream-200 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) return <div className="container mx-auto p-8 text-center">Prodotto non trovato.</div>;

  // Negozio sospeso o non approvato → prodotto non acquistabile
  if (!product.profiles?.is_approved) {
    return (
      <div className="container mx-auto p-8 max-w-md text-center mt-8 bg-white rounded-2xl border">
        <div className="text-5xl mb-3">🚫</div>
        <h1 className="text-xl font-bold text-ink-900 mb-2">Prodotto non disponibile</h1>
        <p className="text-sm text-ink-600 mb-5">
          Questo prodotto non è al momento acquistabile perché il negozio non è operativo.
        </p>
        <a href="/" className="inline-block bg-primary-700 hover:bg-primary-800 text-white px-5 py-2.5 rounded-lg font-semibold">
          ← Torna al marketplace
        </a>
      </div>
    );
  }

  const images: string[] = Array.isArray(product.images) && product.images.length > 0
    ? (product.images as string[])
    : ['https://placehold.co/600x600/eef2ff/6366f1?text=Foto+prodotto'];

  const avgRating = reviews.length
    ? reviews.reduce((s: number, r: any) => s + Number(r.rating), 0) / reviews.length
    : 0;

  const price = Number(product.price);
  const freeShipping = price >= FREE_SHIPPING_THRESHOLD;
  const stock: number | undefined = product.stock ?? undefined;
  const isLowStock = stock !== undefined && stock > 0 && stock <= LOW_STOCK_THRESHOLD;
  const isOutOfStock = stock === 0;

  const sellerProfile = Array.isArray(product.profiles) ? product.profiles[0] : product.profiles;

  const handleAdd = () => {
    addToCart({
      id: product.id,
      name: product.name,
      price,
      image: images[0],
      quantity,
      sellerId: product.seller_id ?? sellerProfile?.id ?? undefined,
      storeName: sellerProfile?.store_name ?? undefined,
    });
    toast.success(`${product.name} aggiunto al carrello`, { duration: 2000 });
  };

  const productSchema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description ?? undefined,
    image: images,
    offers: {
      '@type': 'Offer',
      price: price.toFixed(2),
      priceCurrency: 'EUR',
      availability: isOutOfStock
        ? 'https://schema.org/OutOfStock'
        : 'https://schema.org/InStock',
      seller: sellerProfile?.store_name
        ? { '@type': 'LocalBusiness', name: sellerProfile.store_name }
        : undefined,
    },
    aggregateRating: avgRating > 0 ? {
      '@type': 'AggregateRating',
      ratingValue: avgRating.toFixed(1),
      reviewCount: reviews.length,
    } : undefined,
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />
      {/* Breadcrumb */}
      <nav className="text-sm text-ink-500 mb-4">
        <Link href="/" className="hover:underline">Home</Link>
        {product.categories && (
          <>
            <span className="mx-1">›</span>
            <Link href={`/category/${product.categories.slug}`} className="hover:underline">
              {product.categories.name}
            </Link>
          </>
        )}
        <span className="mx-1">›</span>
        <span className="text-ink-700">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_1fr_320px] gap-6">
        {/* GALLERIA */}
        <div className="space-y-3">
          <div className="relative w-full aspect-square bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl overflow-hidden border">
            <Image src={sizedImage(images[activeImg], 'detail')} alt={product.name} fill priority sizes="(min-width: 1024px) 480px, (min-width: 640px) 50vw, 100vw" unoptimized className="object-contain p-4" />
            {isOutOfStock && (
              <div className="absolute top-4 left-4 bg-ink-900 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                ESAURITO
              </div>
            )}
            {isLowStock && !isOutOfStock && (
              <div className="absolute top-4 left-4 bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-full animate-pulse">
                🔥 SOLO {stock} DISPONIBILI
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="grid grid-cols-5 gap-2">
              {images.slice(0, 5).map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImg(i)}
                  className={`relative aspect-square bg-cream-100 rounded-lg overflow-hidden border-2 transition ${
                    activeImg === i ? 'border-indigo-500' : 'border-transparent hover:border-cream-300'
                  }`}
                >
                  <Image src={sizedImage(img, 'thumb')} alt="" fill sizes="80px" loading="lazy" unoptimized className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* INFO */}
        <div className="space-y-4">
          {product.profiles && (
            <Link
              href={`/store/${product.profiles.id}`}
              className="inline-flex items-center gap-2 text-sm text-primary-700 hover:underline bg-primary-50 px-3 py-1.5 rounded-full"
            >
              🏪 {product.profiles.store_name}
            </Link>
          )}

          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold text-ink-900 flex-1">{product.name}</h1>
            <button
              type="button"
              onClick={() => {
                toggleFav.mutate(id, {
                  onError: (err: any) => {
                    if (err?.message === 'AUTH_REQUIRED') {
                      toast.error('Accedi per salvare nei preferiti');
                    }
                  },
                });
              }}
              aria-label={isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
              aria-pressed={isFav}
              className={`shrink-0 w-11 h-11 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 ${
                isFav
                  ? 'bg-rose-500 border-rose-500 text-white'
                  : 'bg-white border-cream-300 text-ink-300 hover:text-rose-400 hover:border-rose-200'
              }`}
            >
              <Heart size={20} strokeWidth={2.4} fill={isFav ? 'currentColor' : 'none'} aria-hidden />
            </button>
          </div>

          {/* Aggiungi a lista */}
          <div className="flex">
            <AddToListButton productId={id} />
          </div>

          {/* Rating */}
          <div className="flex items-center gap-3 flex-wrap">
            {reviews.length > 0 ? (
              <>
                <span className="text-accent-500 text-lg">
                  {'★'.repeat(Math.round(avgRating))}{'☆'.repeat(5 - Math.round(avgRating))}
                </span>
                <span className="text-sm text-ink-600 underline cursor-pointer">
                  {reviews.length} recensioni
                </span>
              </>
            ) : (
              <span className="text-sm text-ink-400">Sii il primo a recensire questo prodotto</span>
            )}
          </div>

          <div className="border-y py-4">
            <div className="flex items-baseline gap-3 mb-1">
              <span className="text-4xl font-extrabold text-ink-900">{formatPrice(price)}</span>
              <span className="text-sm text-ink-400">IVA inclusa</span>
            </div>
            {/* Trust signal forte: confronto vs media categoria (Behavioral Scientist) */}
            <div className="mb-2 space-y-2">
              <ActivePromoBadge productId={id} basePrice={price} />
              <PriceComparison productId={id} categoryId={product.category_id ?? null} currentPrice={price} />
            </div>
            {freeShipping ? (
              <p className="text-olive-600 font-semibold text-sm">
                ✓ <strong>Spedizione GRATUITA</strong> · Consegna in 24-48h
              </p>
            ) : (
              <p className="text-ink-600 text-sm">
                Aggiungi <strong>{formatPrice(FREE_SHIPPING_THRESHOLD - price)}</strong> per la spedizione gratuita
              </p>
            )}
          </div>

          <div>
            <h3 className="font-bold text-sm uppercase tracking-wide text-ink-500 mb-2">Descrizione</h3>
            <p className="text-ink-700 leading-relaxed whitespace-pre-line">{product.description}</p>
          </div>

          {/* Caratteristiche */}
          {product.attributes &&
            typeof product.attributes === 'object' &&
            Object.keys(product.attributes).length > 0 && (
              <div>
                <h3 className="font-bold text-sm uppercase tracking-wide text-ink-500 mb-2">
                  Caratteristiche
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                  {Object.entries(product.attributes as Record<string, unknown>).map(
                    ([key, value]) => (
                      <div
                        key={key}
                        className="flex justify-between items-baseline gap-3 py-1.5 border-b border-cream-200"
                      >
                        <dt className="text-sm text-ink-500">{findLabelForKey(key)}</dt>
                        <dd className="text-sm text-ink-800 font-medium text-right">
                          {formatAttributeValue(value)}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              </div>
            )}

          {/* Trust signals */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            {[
              { icon: '💰', label: 'Pagamento alla consegna' },
              { icon: '🚚', label: 'Consegna in 24-48h' },
              { icon: '↩️', label: 'Reso entro 14 giorni' },
              { icon: '🏘️', label: 'Venditore locale' },
            ].map((t) => (
              <div key={t.label} className="flex items-center gap-2 text-xs text-ink-700 bg-cream-50 rounded-lg px-3 py-2">
                <span className="text-lg">{t.icon}</span>
                <span className="font-medium">{t.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* CTA STICKY */}
        <div className="lg:sticky lg:top-32 h-fit">
          <div className="bg-white border-2 border-accent-300 rounded-xl p-5 shadow-lg space-y-3">
            <div className="text-2xl font-extrabold text-ink-900">{formatPrice(price)}</div>
            {freeShipping && (
              <p className="text-olive-600 text-xs font-bold">SPEDIZIONE GRATUITA</p>
            )}
            <p className="text-xs">
              {isOutOfStock ? (
                <span className="text-red-600 font-bold">❌ Esaurito</span>
              ) : isLowStock ? (
                <span className="text-red-600 font-bold">🔥 Solo {stock} disponibili — affrettati!</span>
              ) : (
                <span className="text-olive-600 font-bold">✓ Disponibile · pronto per la spedizione</span>
              )}
            </p>

            <div className="flex items-center gap-3 pt-2">
              <label className="text-sm font-medium">Q.tà:</label>
              <div className="flex items-center border rounded-lg">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-9 h-9 hover:bg-cream-50 rounded-l-lg"
                >−</button>
                <span className="w-10 text-center font-semibold">{quantity}</span>
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="w-9 h-9 hover:bg-cream-50 rounded-r-lg"
                >+</button>
              </div>
            </div>

            <button
              onClick={handleAdd}
              disabled={isOutOfStock}
              className="w-full bg-accent-400 hover:bg-accent-500 disabled:bg-cream-300 disabled:cursor-not-allowed text-ink-900 py-3 rounded-lg font-bold shadow-md hover:shadow-lg transition-all"
            >
              {isOutOfStock ? 'Non disponibile' : '🛒 Aggiungi al carrello'}
            </button>

            <Link
              href="/cart"
              className="block w-full text-center bg-ink-900 hover:bg-ink-800 text-white py-3 rounded-lg font-bold"
            >
              Acquista ora
            </Link>

            {(sellerProfile?.id ?? product.seller_id) && (
              <ContactSellerButton
                sellerId={sellerProfile?.id ?? product.seller_id}
                className="w-full"
                label="💬 Contatta il venditore"
              />
            )}

            <div className="pt-3 border-t space-y-1.5 text-xs text-ink-500">
              <p>📦 Venduto e spedito da <strong className="text-ink-700">{product.profiles?.store_name}</strong></p>
              <p>🔒 Acquisto protetto al 100%</p>
            </div>
          </div>
        </div>
      </div>

      {/* RECENSIONI */}
      <section className="mt-12 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-2xl font-extrabold">
            Recensioni
            {reviews.length > 0 && (
              <span className="ml-3 text-base font-normal text-ink-500">
                <span className="text-accent-400">★</span> {avgRating.toFixed(1)} ({reviews.length})
              </span>
            )}
          </h2>
        </div>

        {/* Form nuova recensione */}
        <div className="bg-white border-2 border-primary-100 rounded-xl p-5">
          <h3 className="font-bold text-ink-900 mb-3">Lascia la tua recensione</h3>
          {!isAuthenticated ? (
            <p className="text-sm text-ink-600">
              <Link href={`/sign-in?returnTo=/product/${id}`} className="text-primary-700 font-semibold hover:underline">
                Accedi
              </Link>{' '}
              per recensire questo prodotto.
            </p>
          ) : (
            <form
              onSubmit={(e) => { e.preventDefault(); submitReview.mutate(); }}
              className="space-y-3"
            >
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setReviewRating(n)}
                    className="text-3xl hover:scale-110 transition-transform"
                    aria-label={`${n} stelle`}
                  >
                    <span className={n <= reviewRating ? 'text-accent-400' : 'text-ink-300'}>★</span>
                  </button>
                ))}
              </div>
              <textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                rows={3}
                placeholder="Scrivi un commento (opzionale)…"
                className="w-full border border-cream-300 p-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
              />
              {/* Foto recensione: +20 punti, +35% credibilità (CRO Specialist) */}
              {profile?.id && (
                <PhotoReviewUpload
                  userId={profile.id}
                  productId={id}
                  onUploaded={setReviewPhotos}
                />
              )}
              <button
                type="submit"
                disabled={submitReview.isPending}
                className="bg-primary-700 hover:bg-primary-800 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-semibold text-sm"
              >
                {submitReview.isPending ? 'Invio…' : 'Pubblica recensione'}
              </button>
            </form>
          )}
        </div>

        {/* Lista recensioni */}
        {reviews.length === 0 ? (
          <div className="bg-white border rounded-xl p-8 text-center">
            <p className="text-4xl mb-2">⭐</p>
            <p className="text-ink-600 font-medium">Nessuna recensione ancora</p>
            <p className="text-sm text-ink-400">Sii il primo a condividere la tua esperienza</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reviews.map((r: any) => (
              <div key={r.id} className="bg-white border border-cream-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-accent-500 text-lg">
                      {'★'.repeat(Math.round(Number(r.rating)))}{'☆'.repeat(5 - Math.round(Number(r.rating)))}
                    </p>
                    {/* Verified Purchase badge — Trust & Safety insight */}
                    {r.verified_purchase && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-olive-100 text-olive-800 px-2 py-0.5 rounded-full">
                        ✓ Acquisto verificato
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-400">
                    {new Date(r.created_at).toLocaleDateString('it-IT')}
                  </p>
                </div>
                {r.comment && <p className="text-ink-700 text-sm mb-2">{r.comment}</p>}
                {/* Foto recensione: grid responsive (Mobile Engineer) */}
                {Array.isArray(r.photo_urls) && r.photo_urls.length > 0 && (
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {r.photo_urls.slice(0, 4).map((url: string, i: number) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block relative aspect-square rounded-lg overflow-hidden bg-cream-100 hover:opacity-80">
                        <Image
                          src={sizedImage(url, 'card')}
                          alt="Foto recensione"
                          fill
                          sizes="(max-width: 768px) 25vw, 200px"
                          className="object-cover"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Q&A */}
      <section className="mt-12">
        <ProductQA
          productId={id}
          sellerId={sellerProfile?.id ?? product.seller_id}
        />
      </section>

      {/* Ultimi visti dell'utente (esclude questo prodotto) */}
      <section className="mt-12">
        <RecentlyViewed excludeId={id} />
      </section>

      {/* CORRELATI: SimilarProducts intelligente (seller + categoria) */}
      <section className="mt-12">
        <SimilarProducts
          productId={id}
          categoryId={product.category_id ?? undefined}
          sellerId={sellerProfile?.id ?? product.seller_id}
        />
      </section>

      {/* Sticky CTA mobile */}
      <StickyAddToCart price={price} available={!isOutOfStock} onAdd={handleAdd} />

      {/* Tracking view (side-effect only) */}
      <ProductViewTracker productId={id} />
    </div>
  );
}

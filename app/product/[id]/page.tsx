'use client';

import { useState, use, useRef, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart, Banknote, Bike, RotateCcw, Store, ShoppingCart, Ban, Check, Flame, Package, ShieldCheck, Star } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { addToCart } from '@/lib/cart';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { FREE_SHIPPING_THRESHOLD, LOW_STOCK_THRESHOLD } from '@/lib/constants';
import ProductGrid from '@/components/ProductGrid';
import { findLabelForKey, formatAttributeValue } from '@/lib/category-attributes';
import { UNIT_SUFFIX, CONDITION_LABELS, type ProductUnit, type ProductCondition } from '@/lib/products/schema';
import { deriveOptionGroups, findVariant } from '@/lib/products/variants';
import { loadProductVariants } from '@/lib/products/persistVariants';
import { useFavorites } from '@/components/hooks/useFavorites';
import { useProfile } from '@/components/hooks/useProfile';
import ContactSellerButton from '@/components/ContactSellerButton';
import ProductViewTracker from '@/components/ProductViewTracker';
import ProductQA from '@/components/ProductQA';
import RecentlyViewed from '@/components/RecentlyViewed';
import StickyAddToCart from '@/components/StickyAddToCart';
import SimilarProducts from '@/components/SimilarProducts';
import ActivePromoBadge from '@/components/ActivePromoBadge';
import AddToListButton from '@/components/AddToListButton';
import PhotoReviewUpload from '@/components/PhotoReviewUpload';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DeliveryCutoff } from '@/components/ui/DeliveryCutoff';
import { useExternalProduct } from '@/components/hooks/useExternalProduct';
import { FreeShippingProgress } from '@/components/ui/FreeShippingProgress';
import { SocialProof } from '@/components/ui/SocialProof';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

export default function ProductPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { id } = params;
  const router = useRouter();
  const qc = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [activeImg, setActiveImg] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  // Carosello: contenitore scroll-snap della foto principale + swipe nel lightbox.
  const galleryRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const { isAuthenticated, profile } = useProfile();
  const { favorites, toggle: toggleFav } = useFavorites();
  const isFav = favorites.has(id);

  // Form recensione
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewPhotos, setReviewPhotos] = useState<string[]>([]);

  const { data: product, isLoading } = useQuery({
    queryKey: queryKeys.products.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select(`
        *, categories ( slug, name ), profiles!products_seller_id_fkey ( id, store_name, is_approved )
      `).eq('id', id).single();
      if (error) throw error;
      return data;
    },
  });

  // Varianti (taglie/colori): caricate a parte, alimentano i selettori opzione.
  const { data: variants = [] } = useQuery({
    queryKey: ['product-variants', id],
    queryFn: () => loadProductVariants(id),
  });

  // Prodotto importato da marketplace: tempo di consegna esterno in tempo reale
  // (snapshot in cache + refresh in background lato server).
  const external = useExternalProduct(id, {
    hasExternal: !!(product as { external_source_url?: string | null } | undefined)?.external_source_url,
  });

  type ReviewRow = {
    id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    user_id: string;
    photo_urls: string[] | null;
    verified_purchase: boolean;
  };
  const { data: reviews = [] } = useQuery({
    queryKey: queryKeys.reviews.detail(id),
    queryFn: async (): Promise<ReviewRow[]> => {
      const { data, error } = await supabase.from('reviews')
        .select('id, rating, comment, created_at, user_id, photo_urls, verified_purchase').eq('product_id', id)
        .order('verified_purchase', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReviewRow[];
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

      // SICUREZZA: il bonus fedeltà per recensione-con-foto (+20) è accreditato
      // SERVER-SIDE da un trigger su `reviews` (migration 059), con valore fisso.
      // Prima veniva chiamata `award_loyalty_points` dal browser con p_delta
      // arbitrario: un utente poteva accreditarsi punti illimitati. La RPC ora
      // è eseguibile solo da service_role.
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.reviews.detail(id) });
      setReviewComment('');
      setReviewRating(5);
      setReviewPhotos([]);
      toast.success(
        reviewPhotos.length > 0
          ? `Grazie! Recensione pubblicata · +20 punti loyalty per le foto 🎉`
          : 'Grazie per la recensione!'
      );
    },
    onError: (err: unknown) => {
      if (err instanceof Error && err.message !== 'REDIRECT') toast.error(friendlyError(err));
    },
  });

  // Quando si chiude il lightbox (dove si naviga con frecce/swipe), riallinea
  // il carosello principale alla foto corrente.
  useEffect(() => {
    if (lightbox) return;
    const el = galleryRef.current;
    if (el) el.scrollTo({ left: activeImg * el.clientWidth, behavior: 'auto' });
  }, [lightbox, activeImg]);

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
        <Ban size={48} strokeWidth={1.5} className="mx-auto text-ink-300 mb-3" aria-hidden />
        <h1 className="text-xl font-bold text-ink-900 mb-2">Prodotto non disponibile</h1>
        <p className="text-sm text-ink-600 mb-5">
          Questo prodotto non è al momento acquistabile perché il negozio non è operativo.
        </p>
        <Button href="/">← Torna al marketplace</Button>
      </div>
    );
  }

  const images: string[] = Array.isArray(product.images) && product.images.length > 0
    ? (product.images as string[])
    : ['https://placehold.co/600x600/eef2ff/6366f1?text=Foto+prodotto'];

  const avgRating = reviews.length
    ? reviews.reduce((s: number, r) => s + Number(r.rating), 0) / reviews.length
    : 0;

  const price = Number(product.price);
  const freeShipping = price >= FREE_SHIPPING_THRESHOLD;
  // Prezzo pieno barrato + unità + condizione (campi di primo livello).
  const compareAt = (product as { compare_at_price?: number | string | null }).compare_at_price;
  const compareAtNum = compareAt != null ? Number(compareAt) : null;
  const compareValid = compareAtNum != null && compareAtNum > price;
  const comparePct = compareValid ? Math.round((1 - price / compareAtNum) * 100) : 0;
  const unitRaw = (product as { unit?: string | null }).unit ?? null;
  const unitSuffix = unitRaw && unitRaw !== 'pezzo' ? (UNIT_SUFFIX[unitRaw as ProductUnit] ?? '') : '';
  const conditionRaw = (product as { condition?: string | null }).condition ?? null;
  const conditionLabel = conditionRaw ? (CONDITION_LABELS[conditionRaw as ProductCondition] ?? conditionRaw) : null;
  // Varianti: i selettori derivano dalle varianti; la disponibilità mostrata è
  // quella della variante selezionata (o del prodotto se non ci sono varianti).
  const hasVariants = Boolean((product as { has_variants?: boolean }).has_variants) || variants.length > 0;
  const optionGroups = hasVariants ? deriveOptionGroups(variants) : [];
  const allOptionsChosen = optionGroups.length > 0 && optionGroups.every((g) => selectedOptions[g.name]);
  const selectedVariant = allOptionsChosen ? findVariant(variants, selectedOptions) : null;
  const needsVariantChoice = hasVariants && !selectedVariant;

  const stock: number | undefined = hasVariants
    ? (selectedVariant ? selectedVariant.stock : undefined)
    : (product.stock ?? undefined);
  const isLowStock = stock !== undefined && stock > 0 && stock <= LOW_STOCK_THRESHOLD;
  const isOutOfStock = stock === 0;
  const canAdd = !isOutOfStock && !needsVariantChoice;

  const sellerProfile = Array.isArray(product.profiles) ? product.profiles[0] : product.profiles;

  const handleAdd = () => {
    if (needsVariantChoice) {
      toast.error(`Scegli ${optionGroups.map((g) => g.name.toLowerCase()).join(' e ')} prima di aggiungere`);
      return;
    }
    addToCart({
      id: product.id,
      name: product.name,
      price,
      image: images[0],
      quantity,
      sellerId: product.seller_id ?? sellerProfile?.id ?? undefined,
      storeName: sellerProfile?.store_name ?? undefined,
      variantId: selectedVariant?.id,
      variantLabel: selectedVariant?.label,
    });
    toast.success(
      `${product.name}${selectedVariant ? ` (${selectedVariant.label})` : ''} aggiunto al carrello`,
      { duration: 2000 },
    );
  };

  const handleBuyNow = () => {
    if (needsVariantChoice) {
      toast.error(`Scegli ${optionGroups.map((g) => g.name.toLowerCase()).join(' e ')} prima di continuare`);
      return;
    }
    addToCart({
      id: product.id,
      name: product.name,
      price,
      image: images[0],
      quantity,
      sellerId: product.seller_id ?? sellerProfile?.id ?? undefined,
      storeName: sellerProfile?.store_name ?? undefined,
      variantId: selectedVariant?.id,
      variantLabel: selectedVariant?.label,
    });
    router.push('/checkout');
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
      <Breadcrumb className="mb-4" items={[
        { label: 'Home', href: '/' },
        ...(product.categories ? [{ label: product.categories.name, href: `/category/${product.categories.slug}` }] : []),
        { label: product.name },
      ]} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_1fr_320px] gap-6">
        {/* GALLERIA — carosello scorrevole (swipe/scroll orizzontale) */}
        <div className="space-y-3">
          <div className="relative w-full aspect-square rounded-xl overflow-hidden border border-surface-200">
            <div
              ref={galleryRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                if (!el.clientWidth) return;
                const idx = Math.round(el.scrollLeft / el.clientWidth);
                if (idx !== activeImg && idx >= 0 && idx < images.length) setActiveImg(idx);
              }}
              className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scrollbar-hide bg-surface-0"
            >
              {images.map((img, i) => (
                <div key={i} className="relative h-full w-full shrink-0 snap-center">
                  <Image
                    src={sizedImage(img, 'detail')}
                    alt={i === 0 ? product.name : `${product.name} — foto ${i + 1}`}
                    fill
                    priority={i === 0}
                    sizes="(min-width: 1024px) 480px, (min-width: 640px) 50vw, 100vw"
                    unoptimized
                    className="object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setLightbox(true)}
                    aria-label="Ingrandisci foto"
                    className="absolute inset-0 z-[1] cursor-zoom-in"
                  />
                </div>
              ))}
            </div>
            {isOutOfStock && (
              <Badge variant="soldout" size="md" className="absolute top-4 left-4 z-[2]">ESAURITO</Badge>
            )}
            {isLowStock && !isOutOfStock && (
              <Badge variant="lowstock" size="md" className="absolute top-4 left-4 z-[2]">
                {stock === 1 ? 'Ultimo pezzo' : `Solo ${stock} rimasti`}
              </Badge>
            )}
            {/* Pallini indicatore (mobile) */}
            {images.length > 1 && (
              <div className="absolute bottom-3 left-1/2 z-[2] flex -translate-x-1/2 gap-1.5 sm:hidden">
                {images.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${activeImg === i ? 'w-4 bg-primary-600' : 'w-1.5 bg-white/70 ring-1 ring-surface-300'}`}
                  />
                ))}
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="grid grid-cols-5 gap-2">
              {images.slice(0, 5).map((img, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setActiveImg(i);
                    const el = galleryRef.current;
                    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
                  }}
                  aria-label={`Mostra foto ${i + 1}`}
                  aria-pressed={activeImg === i}
                  className={`relative aspect-square bg-surface-50 rounded-lg overflow-hidden border-2 transition ${
                    activeImg === i ? 'border-primary-600' : 'border-transparent hover:border-surface-300'
                  }`}
                >
                  <Image src={sizedImage(img, 'thumb')} alt="" fill sizes="80px" loading="lazy" unoptimized className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* LIGHTBOX a schermo intero — vede la foto intera, con navigazione */}
        {lightbox && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
            onClick={() => setLightbox(false)}
            onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null; }}
            onTouchEnd={(e) => {
              const start = touchStartX.current;
              touchStartX.current = null;
              if (start == null || images.length < 2) return;
              const dx = (e.changedTouches[0]?.clientX ?? start) - start;
              if (Math.abs(dx) < 40) return;
              setActiveImg((prev) =>
                dx < 0 ? (prev + 1) % images.length : (prev - 1 + images.length) % images.length,
              );
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`Foto di ${product.name}`}
          >
            <button
              type="button"
              onClick={() => setLightbox(false)}
              aria-label="Chiudi"
              className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white hover:bg-white/25"
            >
              ×
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sizedImage(images[activeImg], 'hero')}
              alt={product.name}
              className="max-h-[90vh] max-w-[95vw] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActiveImg((activeImg - 1 + images.length) % images.length); }}
                  aria-label="Foto precedente"
                  className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-3xl leading-none text-white hover:bg-white/25"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActiveImg((activeImg + 1) % images.length); }}
                  aria-label="Foto successiva"
                  className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-3xl leading-none text-white hover:bg-white/25"
                >
                  ›
                </button>
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white">
                  {activeImg + 1} / {images.length}
                </div>
              </>
            )}
          </div>
        )}

        {/* INFO */}
        <div className="space-y-4">
          {product.profiles && (
            <Link
              href={`/store/${product.profiles.id}`}
              className="inline-flex items-center gap-2 text-sm text-primary-700 hover:underline bg-primary-50 px-3 py-1.5 rounded-full"
            >
              <Store size={14} strokeWidth={2.2} aria-hidden /> {product.profiles.store_name}
            </Link>
          )}

          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold text-ink-900 flex-1">{product.name}</h1>
            <button
              type="button"
              onClick={() => {
                toggleFav.mutate(id, {
                  onError: (err: unknown) => {
                    if (err instanceof Error && err.message === 'AUTH_REQUIRED') {
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
            <SocialProof productId={id} />
          </div>

          <div className="border-y border-surface-200 py-4 space-y-3">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-4xl font-extrabold text-ink-900">
                {formatPrice(price)}
                {unitSuffix && <span className="text-base font-semibold text-ink-400">{unitSuffix}</span>}
              </span>
              {compareValid && (
                <>
                  <span className="text-lg text-ink-400 line-through">{formatPrice(compareAtNum)}</span>
                  <span className="text-sm font-bold text-secondary-600">-{comparePct}%</span>
                </>
              )}
              <span className="text-sm text-ink-400">IVA inclusa</span>
            </div>
            {conditionLabel && (
              <span className="inline-flex w-fit items-center rounded-full bg-cream-100 px-2.5 py-0.5 text-xs font-semibold text-ink-700">
                Condizione: {conditionLabel}
              </span>
            )}
            {/* Promo attiva del negozio (prezzo barrato + nuovo prezzo) */}
            <ActivePromoBadge productId={id} basePrice={price} />

            {/* Zero rischio: la leva più forte di questo marketplace (COD) */}
            <div className="flex items-center gap-2.5 rounded-lg bg-olive-50 border border-olive-200 px-3 py-2.5">
              <Banknote size={20} strokeWidth={2.2} className="text-olive-600 shrink-0" aria-hidden />
              <p className="text-sm text-olive-800">
                <strong>Paghi alla consegna in contanti</strong> — zero rischio, zero carta.
              </p>
            </div>

            {/* Consegna: marketplace esterno se importato, altrimenti Express/Standard */}
            <DeliveryCutoff variant="inline" available={!isOutOfStock} externalDeliveryLabel={external?.delivery_label} />

            {/* Barra spedizione gratis reattiva alla quantità — versione leggera */}
            <FreeShippingProgress subtotal={price * quantity} />
          </div>

          {/* SELETTORE VARIANTI (taglie/colori) */}
          {hasVariants && optionGroups.length > 0 && (
            <div className="space-y-3">
              {optionGroups.map((g) => (
                <div key={g.name}>
                  <p className="text-sm font-semibold text-ink-700 mb-1.5">
                    {findLabelForKey(g.name)}
                    {selectedOptions[g.name] && (
                      <span className="ml-1.5 font-normal text-ink-500">· {selectedOptions[g.name]}</span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {g.values.map((val) => {
                      const active = selectedOptions[g.name] === val;
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setSelectedOptions((prev) => ({ ...prev, [g.name]: val }))}
                          aria-pressed={active}
                          className={`min-w-[2.5rem] rounded-lg border-2 px-3 py-1.5 text-sm font-semibold transition ${
                            active
                              ? 'border-primary-600 bg-primary-50 text-primary-800'
                              : 'border-surface-300 bg-white text-ink-700 hover:border-primary-300'
                          }`}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {needsVariantChoice ? (
                <p className="text-xs text-ink-500">
                  Scegli {optionGroups.map((g) => g.name.toLowerCase()).join(' e ')} per vedere la disponibilità.
                </p>
              ) : selectedVariant && selectedVariant.stock === 0 ? (
                <p className="text-xs font-semibold text-secondary-700">Variante esaurita — prova un&apos;altra combinazione.</p>
              ) : selectedVariant && selectedVariant.stock <= LOW_STOCK_THRESHOLD ? (
                <p className="text-xs font-semibold text-secondary-700">
                  {selectedVariant.stock === 1 ? 'Ultimo pezzo' : `Solo ${selectedVariant.stock} rimasti`} per «{selectedVariant.label}».
                </p>
              ) : null}
            </div>
          )}

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

          {/* Trust signals — riga leggera, senza box, per non distrarre dalla CTA */}
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-xs text-ink-500">
            {[
              { Icon: Banknote, label: 'Paghi alla consegna' },
              { Icon: Store, label: 'Negozi di Piacenza' },
              { Icon: Bike, label: 'Consegna oggi o domani' },
              { Icon: RotateCcw, label: 'Reso entro 14 giorni' },
            ].map((t) => (
              <span key={t.label} className="inline-flex items-center gap-1.5">
                <t.Icon size={14} strokeWidth={2} className="text-ink-400 shrink-0" aria-hidden />
                {t.label}
              </span>
            ))}
          </div>
        </div>

        {/* CTA STICKY */}
        <div className="lg:sticky lg:top-32 h-fit">
          <div className="bg-surface-0 border border-surface-200 rounded-xl p-5 shadow-card space-y-3">
            <div className="text-2xl font-extrabold text-ink-900">{formatPrice(price)}</div>
            {freeShipping && (
              <Badge variant="free" icon={Bike}>Spedizione gratuita</Badge>
            )}
            <p className="text-xs">
              {isOutOfStock ? (
                <span className="text-secondary-700 font-bold">Esaurito</span>
              ) : isLowStock ? (
                <span className="text-secondary-700 font-bold inline-flex items-center gap-1"><Flame size={13} strokeWidth={2.4} aria-hidden /> {stock === 1 ? 'Ultimo pezzo' : `Solo ${stock} rimasti`}</span>
              ) : (
                <span className="text-olive-700 font-bold inline-flex items-center gap-1"><Check size={13} strokeWidth={2.6} aria-hidden /> Disponibile · pronto per la consegna</span>
              )}
            </p>

            <div className="flex items-center gap-3 pt-2">
              <label className="text-sm font-medium">Q.tà:</label>
              <div className="flex items-center border border-surface-300 rounded-lg">
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  aria-label="Diminuisci quantità"
                  className="w-9 h-9 hover:bg-surface-50 rounded-l-lg"
                >−</button>
                <span className="w-10 text-center font-semibold">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(quantity + 1)}
                  aria-label="Aumenta quantità"
                  className="w-9 h-9 hover:bg-surface-50 rounded-r-lg"
                >+</button>
              </div>
            </div>

            <Button
              variant="accent"
              size="lg"
              fullWidth
              onClick={handleAdd}
              disabled={!canAdd}
              icon={canAdd ? ShoppingCart : undefined}
            >
              {needsVariantChoice ? 'Scegli le opzioni' : isOutOfStock ? 'Non disponibile' : 'Aggiungi al carrello'}
            </Button>

            <button
              type="button"
              onClick={handleBuyNow}
              disabled={!canAdd}
              className="block w-full text-center bg-ink-900 hover:bg-ink-800 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-lg font-bold"
            >
              Compra ora · paghi alla consegna
            </button>

            {(sellerProfile?.id ?? product.seller_id) && (
              <ContactSellerButton
                sellerId={sellerProfile?.id ?? product.seller_id}
                className="w-full"
                label="Contatta il venditore"
              />
            )}

            <div className="pt-3 border-t border-surface-200 space-y-1.5 text-xs text-ink-500">
              <p className="flex items-center gap-1.5"><Package size={13} className="shrink-0" aria-hidden /> Venduto e consegnato da <strong className="text-ink-700">{product.profiles?.store_name}</strong></p>
              <p className="flex items-center gap-1.5"><ShieldCheck size={13} className="shrink-0" aria-hidden /> Compri sicuro: paghi solo quando arriva.</p>
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
              <Button type="submit" loading={submitReview.isPending} size="sm">Pubblica recensione</Button>
            </form>
          )}
        </div>

        {/* Lista recensioni */}
        {reviews.length === 0 ? (
          <div className="bg-white border rounded-xl p-8 text-center">
            <Star size={40} strokeWidth={1.5} className="mx-auto text-ink-300 mb-2" aria-hidden />
            <p className="text-ink-600 font-medium">Nessuna recensione ancora</p>
            <p className="text-sm text-ink-400">Sii il primo a condividere la tua esperienza</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reviews.map((r) => (
              <div key={r.id} className="bg-white border border-cream-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-accent-500 text-lg">
                      {'★'.repeat(Math.round(Number(r.rating)))}{'☆'.repeat(5 - Math.round(Number(r.rating)))}
                    </p>
                    {/* Verified Purchase badge — Trust & Safety insight */}
                    {r.verified_purchase && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-olive-100 text-olive-800 px-2 py-0.5 rounded-full">
                        <Check size={11} strokeWidth={3} aria-hidden /> Acquisto verificato
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
      <StickyAddToCart price={price} available={canAdd} onAdd={handleAdd} note="Paghi alla consegna" />

      {/* Tracking view (side-effect only) */}
      <ProductViewTracker
        productId={id}
        price={price}
        category={product.categories?.slug ?? undefined}
        sellerId={sellerProfile?.id ?? product.seller_id ?? undefined}
      />
    </div>
  );
}

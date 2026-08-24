'use client';

import { memo, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Flame, Heart, Plus, Truck } from 'lucide-react';
import { addToCart } from '@/lib/cart';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { FREE_SHIPPING_THRESHOLD, LOW_STOCK_THRESHOLD, NEW_PRODUCT_DAYS } from '@/lib/constants';
import { Badge } from './ui/Badge';
import { useFavorites } from './hooks/useFavorites';
import { eAcceso, siPuoPremere, statoInterruttore } from '@/lib/stato-interruttore';
import { useProfile } from './hooks/useProfile';
import { useShoppingMode, useCanPurchase } from './hooks/useShoppingMode';
import caricatoreFotoRemote from '@/lib/image-loader';

interface ProductCardProps {
  id: string;
  name: string;
  description?: string;
  price: number;
  images?: string[];
  rating?: number;
  reviewCount?: number;
  stock?: number;
  createdAt?: string;
  storeName?: string;
  sellerId?: string;
  /** Sconto promo attivo in percentuale (0-100): mostra prezzo barrato + badge. */
  discountPercent?: number;
  /** Prezzo pieno barrato impostato dal venditore (compare_at_price). */
  compareAtPrice?: number | null;
  /** Il prodotto ha varianti (taglie/colori): l'aggiunta rapida porta alla scheda. */
  hasVariants?: boolean;
  /** true per le prime immagini above-the-fold (LCP): eager + fetchPriority alta. */
  priority?: boolean;
}

/**
 * Card prodotto "compatta": la FOTO è l'elemento dominante (~3/5 della card),
 * sotto un corpo essenziale (negozio · titolo · prezzo). Niente stelle vuote,
 * niente bottone a tutta larghezza: un "+" discreto aggiunge al carrello.
 * Pensata sia per la griglia verticale (catalogo) sia per le rail orizzontali (home).
 */
const ProductCard = ({
  id, name, price, images,
  stock, createdAt, storeName, sellerId, discountPercent, compareAtPrice, hasVariants, priority,
}: ProductCardProps) => {
  const hasDiscount = !!discountPercent && discountPercent > 0;
  const discountedPrice = hasDiscount ? price * (1 - (discountPercent as number) / 100) : price;
  // Prezzo pieno barrato del venditore (solo se non c'è già una promo attiva).
  const compareValid = !hasDiscount && !!compareAtPrice && compareAtPrice > price;
  const showStrike = hasDiscount || compareValid;
  const bigPrice = hasDiscount ? discountedPrice : price;
  const strikePrice = hasDiscount ? price : (compareValid ? (compareAtPrice as number) : 0);
  const badgePct = hasDiscount
    ? (discountPercent as number)
    : (compareValid ? Math.round((1 - price / (compareAtPrice as number)) * 100) : 0);
  const rawImg = images?.[0] ?? 'https://placehold.co/400x400/FBF7F0/C0492C?text=Foto';
  const img = sizedImage(rawImg, 'card');
  const router = useRouter();
  const { favorites, lettoDavvero: preferitiLetti, toggle } = useFavorites();
  const { isSeller, isAdmin } = useProfile();
  const shoppingMode = useShoppingMode(isSeller);
  const canPurchase = useCanPurchase(isAdmin, isSeller, shoppingMode);
  // Tre stati, non due: la regola sta in `lib/stato-interruttore.ts` e la usano anche il bottone
  // «Segui» e la scheda prodotto. Sul terzo il cuore non dice di no e il bottone non agisce —
  // `toggle` sceglie fra aggiungere e togliere guardando la lista, e su una lista non letta
  // sceglierebbe a caso.
  const statoCuore = statoInterruttore({ letto: preferitiLetti, dentro: favorites.has(id) });
  const isFav = eAcceso(statoCuore);
  const cuorePremibile = siPuoPremere(statoCuore);
  const [heartBeat, setHeartBeat] = useState(false);

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 108 — Prima, sui prodotti con varianti, la funzione usciva in silenzio: il
    // clic sul «+» non faceva assolutamente niente, e il cliente lo ripeteva
    // due o tre volte prima di rinunciare. La taglia va scelta: si va lì.
    if (hasVariants) {
      router.push(`/product/${id}`);
      return;
    }
    if (!canPurchase) {
      toast.error(isAdmin
        ? 'Gli account assistenza non possono acquistare sul marketplace.'
        : 'Apri il marketplace dal pulsante «Vai al marketplace» nella dashboard negozio.');
      return;
    }
    // 109 — Entrava `price`, cioè il prezzo PIENO, anche quando la card
    // mostrava «−30%» e il prezzo scontato. Il cliente vedeva 7 €, nel carrello
    // ne trovava 10, e la fiducia se ne andava lì. Il server sconta davvero:
    // era la vetrina a mentire.
    addToCart({ id, name, price: bigPrice, image: img, sellerId, storeName });
    toast.success(`${name} aggiunto al carrello`, { duration: 2000 });
  };

  const handleFav = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Trigger animazione heart-beat ad ogni click (anche unfavorite)
    setHeartBeat(true);
    setTimeout(() => setHeartBeat(false), 600);
    toggle.mutate(id, {
      onError: (err: unknown) => {
        if (err instanceof Error && err.message === 'AUTH_REQUIRED') toast.error('Accedi per salvare nei preferiti');
        else toast.error('Non sono riuscito a salvare il preferito. Riprova fra un momento.');
      },
    });
  };

  // isNew calcolato post-hydration: Date.now() differisce server/client e
  // su prodotti creati vicino al limite NEW_PRODUCT_DAYS causa mismatch.
  const [isNew, setIsNew] = useState(false);
  useEffect(() => {
    if (!createdAt) return;
    const age = (Date.now() - new Date(createdAt).getTime()) / 86400000;
    setIsNew(age < NEW_PRODUCT_DAYS);
  }, [createdAt]);
  const isLowStock = stock !== undefined && stock > 0 && stock <= LOW_STOCK_THRESHOLD;
  const isOutOfStock = stock === 0;
  const freeShipping = price >= FREE_SHIPPING_THRESHOLD;
  // Iniziali del negozio per il mini-logo (modello negozi-first): "Salumeria Verdi" → "SV"
  const initials = (storeName ?? '').trim().split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase();

  return (
    <div
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-surface-200 bg-white transition-all duration-200 hover:-translate-y-1 hover:border-primary-200 hover:shadow-warm-lg"
    >
      {/* Link overlay: copre tutta la card ma sta sotto i pulsanti (z-0). */}
      <Link
        href={`/product/${id}`}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-primary-600 focus-visible:outline-offset-2"
        // 138 — «Esaurito», «-30%» e «Nuovo» erano nascosti allo screen reader
        // (aria-hidden sui badge, per non farli ripetere accanto al link). Il
        // risultato è che chi non vede la scheda non sapeva che il prodotto era
        // esaurito: ci cliccava, e lo scopriva dopo. La strada giusta non è
        // zittire l'informazione, è metterla nel nome del link.
        aria-label={[
          name,
          isOutOfStock ? 'esaurito' : null,
          showStrike ? `scontato del ${badgePct} per cento` : null,
          isNew ? 'novità' : null,
        ].filter(Boolean).join(', ')}
        tabIndex={0}
      />
      {/* Badge in alto a sinistra */}
      <div className="absolute top-2 left-2 z-10 flex flex-col gap-1" aria-hidden>
        {showStrike && <Badge variant="discount">-{badgePct}%</Badge>}
        {isNew && <Badge variant="new">Nuovo</Badge>}
        {isOutOfStock && <Badge variant="soldout">Esaurito</Badge>}
      </div>

      {/* FOTO dominante (~3/5) — object-cover su sfondo bianco: la foto riempie
          il riquadro quadrato (come le demo), niente bande beige sulle foto dei negozi. */}
      <div className="relative aspect-square w-full overflow-hidden bg-white">
        <Image
          src={img}
          alt={name}
          fill
          sizes="(min-width: 1024px) 220px, (min-width: 640px) 33vw, 45vw"
          priority={priority}
          loading={priority ? undefined : 'lazy'}
          loader={caricatoreFotoRemote}
          className="object-cover transition-transform duration-300 group-hover:scale-110"
        />
        <button
          type="button"
          onClick={handleFav}
          disabled={!cuorePremibile}
          aria-label={!cuorePremibile ? 'Non sono riuscito a leggere i tuoi preferiti' : isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
          title={!cuorePremibile ? 'Non sono riuscito a leggere i tuoi preferiti: riprova fra un momento' : undefined}
          className={`absolute top-2 right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 shadow transition-transform ${cuorePremibile ? 'hover:scale-110 hover:bg-white' : 'cursor-not-allowed opacity-60'}`}
        >
          <Heart
            size={16}
            strokeWidth={2}
            className={`${isFav ? 'fill-secondary-500 text-secondary-500' : 'text-ink-400'} ${heartBeat ? 'animate-heart-beat' : ''}`}
          />
        </button>
      </div>

      {/* Corpo compatto — z-10 per stare sopra il link overlay */}
      <div className="relative z-10 flex flex-1 flex-col gap-1 p-2.5">
        {storeName && (
          <div className="flex items-center gap-1.5">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-[8px] font-bold text-white">
              {initials}
            </span>
            <span className="truncate text-[11px] font-semibold text-ink-500">{storeName}</span>
          </div>
        )}
        <h3 className="line-clamp-2 min-h-[2.6em] text-[13px] font-semibold leading-snug text-ink-900 transition-colors group-hover:text-primary-700">
          {name}
        </h3>

        <div className="mt-auto pt-1">
          {(freeShipping || (isLowStock && !isOutOfStock)) && (
            <div className="mb-1 flex flex-wrap items-center gap-1">
              {isLowStock && !isOutOfStock && (
                <Badge variant="lowstocksoft" icon={Flame}>
                  {stock === 1 ? 'Ultimo pezzo' : `Ultimi ${stock}`}
                </Badge>
              )}
              {freeShipping && (
                <Badge variant="free" icon={Truck}>
                  Sped. gratis
                </Badge>
              )}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            {showStrike ? (
              <>
                <span className="text-base font-extrabold text-secondary-600">{formatPrice(bigPrice)}</span>
                <s className="text-[11px] text-ink-500">
                  <span className="sr-only">Prezzo pieno </span>{formatPrice(strikePrice)}
                </s>
              </>
            ) : (
              <span className="text-base font-extrabold text-ink-900">{formatPrice(price)}</span>
            )}
            <button
              type="button"
              onClick={handleAdd}
              disabled={isOutOfStock}
              aria-label={hasVariants ? `Scegli le opzioni di ${name}` : `Aggiungi ${name} al carrello`}
              className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm transition-all hover:bg-primary-700 active:scale-95 disabled:cursor-not-allowed disabled:bg-cream-200 disabled:text-ink-400 disabled:active:scale-100"
            >
              <Plus size={18} strokeWidth={2.6} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(ProductCard);

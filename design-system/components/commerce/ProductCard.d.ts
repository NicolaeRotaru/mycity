import * as React from 'react';

/**
 * Signature marketplace product card — photo-dominant, store chip, price, "+" add.
 *
 * @startingPoint section="Commerce" subtitle="Photo-first product card with badges" viewport="240x340"
 */
export interface ProductCardProps {
  name: string;
  price: number;
  /** Product photo URL. Falls back to a neutral placeholder. */
  image?: string;
  /** Seller / shop name — rendered as an initials chip + label. */
  storeName?: string;
  /** Active promo percentage (0–100): shows struck price + discount badge. */
  discountPercent?: number;
  /** Units left. 0 = sold out; ≤3 = low-stock flame badge. */
  stock?: number;
  /** Delivery ETA chip on the photo: { today: boolean; short: 'Oggi'|'Domani'|'24–48h' }. */
  eta?: { today: boolean; short: string };
  isNew?: boolean;
  freeShipping?: boolean;
  favorite?: boolean;
  onAdd?: () => void;
  onFav?: () => void;
  href?: string;
  style?: React.CSSProperties;
}
export function ProductCard(props: ProductCardProps): React.ReactElement;

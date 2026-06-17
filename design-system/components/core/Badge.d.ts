import * as React from 'react';

export type BadgeVariant =
  | 'discount' | 'new' | 'soldout' | 'lowstock'
  | 'free' | 'cod' | 'local' | 'urgency';

/** Inline promo / status pill — discount is wine, new is olive, urgency is mustard. */
export interface BadgeProps {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  /** Optional leading Lucide icon name. */
  icon?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function Badge(props: BadgeProps): React.ReactElement;

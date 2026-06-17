import * as React from 'react';

export type OrderStatus =
  | 'NEW' | 'ACCEPTED' | 'READY' | 'ASSIGNED'
  | 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELED';

/** Order-status pill — tinted bg + ring + Lucide icon, 8 states from NEW to DELIVERED. */
export interface OrderStatusBadgeProps {
  status: OrderStatus;
  size?: 'sm' | 'md';
  /** `pill` (default), `inline` (text + icon, no chrome) or `icon-only`. */
  variant?: 'pill' | 'inline' | 'icon-only';
  style?: React.CSSProperties;
}
export function OrderStatusBadge(props: OrderStatusBadgeProps): React.ReactElement;

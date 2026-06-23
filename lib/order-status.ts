export type OrderStatus =
  | 'NEW'
  | 'ACCEPTED'
  | 'READY'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELED';

export type PaymentStatus = 'PAID' | 'FAILED' | 'PENDING';

// Icone Lucide standardizzate (la vecchia mappa emoji legacy e' stata rimossa).
// Esperti: "Emoji + Lucide mixati distruggono brand coherence. Lucide-only."
import {
  Clock, ChefHat, Package, Bike, Hand, Truck, CheckCircle2, XCircle,
  type LucideIcon,
} from 'lucide-react';

export const ORDER_STATUS_ICON: Record<OrderStatus, LucideIcon> = {
  NEW:              Clock,
  ACCEPTED:         ChefHat,
  READY:            Package,
  ASSIGNED:         Bike,
  PICKED_UP:        Hand,
  OUT_FOR_DELIVERY: Truck,
  DELIVERED:        CheckCircle2,
  CANCELED:         XCircle,
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  NEW:              'Ordine ricevuto',
  ACCEPTED:         'In preparazione',
  READY:            'Pronto per il ritiro',
  ASSIGNED:         'Rider in arrivo',
  PICKED_UP:        'Ritirato',
  OUT_FOR_DELIVERY: 'In consegna',
  DELIVERED:        'Consegnato',
  CANCELED:         'Annullato',
};

/**
 * Colori semantici dello stato ordine — sorgente unica dei token `--status-*`
 * definiti in app/globals.css (allineati a design-system OrderStatusBadge.jsx).
 *
 * `color`: testo + icona + anello (via currentColor) → token `--status-*`.
 * `bg`:    tinta chiara di sfondo del pill.
 * Niente classi off-palette (amber/blue/violet/...): i colori sono semantici e
 * vivono nei token del design system, applicati via inline style.
 */
export const ORDER_STATUS_COLOR: Record<OrderStatus, { color: string; bg: string }> = {
  NEW:              { color: 'var(--status-new)',       bg: '#FFFBEB' },
  ACCEPTED:         { color: 'var(--status-accepted)',  bg: '#EFF6FF' },
  READY:            { color: 'var(--status-ready)',     bg: '#F5F3FF' },
  ASSIGNED:         { color: 'var(--status-assigned)',  bg: '#EEF2FF' },
  PICKED_UP:        { color: 'var(--status-pickedup)',  bg: '#ECFEFF' },
  OUT_FOR_DELIVERY: { color: 'var(--status-delivery)',  bg: '#FAF5FF' },
  DELIVERED:        { color: 'var(--status-delivered)', bg: '#ECFDF5' },
  CANCELED:         { color: 'var(--status-canceled)',  bg: '#FFF1F2' },
};

// I 6 step principali mostrati nella timeline al buyer (NEW e CANCELED sono casi a parte)
export const BUYER_TIMELINE: OrderStatus[] = [
  'NEW',
  'ACCEPTED',
  'READY',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

export function isPastStatus(current: OrderStatus, step: OrderStatus): boolean {
  const order: OrderStatus[] = [
    'NEW',
    'ACCEPTED',
    'READY',
    'ASSIGNED',
    'PICKED_UP',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
  ];
  const currentIdx = order.indexOf(current);
  const stepIdx = order.indexOf(step);
  return currentIdx >= stepIdx;
}

export function isActiveStatus(current: OrderStatus, step: OrderStatus): boolean {
  if (current === step) return true;
  // ASSIGNED collassa nello step READY (rider sta arrivando al negozio)
  if (current === 'ASSIGNED' && step === 'READY') return true;
  return false;
}

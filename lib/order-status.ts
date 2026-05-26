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

// Icone Lucide standardizzate (sostituiscono ORDER_STATUS_EMOJI legacy).
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
  NEW:              'In attesa di conferma',
  ACCEPTED:         'In preparazione',
  READY:            'Pronto per il pickup',
  ASSIGNED:         'Rider in arrivo al negozio',
  PICKED_UP:        'Ritirato dal negozio',
  OUT_FOR_DELIVERY: 'In consegna',
  DELIVERED:        'Consegnato',
  CANCELED:         'Annullato',
};

export const ORDER_STATUS_EMOJI: Record<OrderStatus, string> = {
  NEW:              '⏳',
  ACCEPTED:         '👨‍🍳',
  READY:            '📦',
  ASSIGNED:         '🛵',
  PICKED_UP:        '✋',
  OUT_FOR_DELIVERY: '🚚',
  DELIVERED:        '✅',
  CANCELED:         '❌',
};

export const ORDER_STATUS_COLOR: Record<OrderStatus, { bg: string; text: string; ring: string }> = {
  NEW:              { bg: 'bg-amber-50',    text: 'text-amber-700',    ring: 'ring-amber-200' },
  ACCEPTED:         { bg: 'bg-blue-50',     text: 'text-blue-700',     ring: 'ring-blue-200' },
  READY:            { bg: 'bg-violet-50',   text: 'text-violet-700',   ring: 'ring-violet-200' },
  ASSIGNED:         { bg: 'bg-indigo-50',   text: 'text-indigo-700',   ring: 'ring-indigo-200' },
  PICKED_UP:        { bg: 'bg-cyan-50',     text: 'text-cyan-700',     ring: 'ring-cyan-200' },
  OUT_FOR_DELIVERY: { bg: 'bg-purple-50',   text: 'text-purple-700',   ring: 'ring-purple-200' },
  DELIVERED:        { bg: 'bg-emerald-50',  text: 'text-emerald-700',  ring: 'ring-emerald-200' },
  CANCELED:         { bg: 'bg-rose-50',     text: 'text-rose-700',     ring: 'ring-rose-200' },
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

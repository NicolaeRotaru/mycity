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
 * definiti in app/globals.css (allineati a docs/mockup OrderStatusBadge.jsx).
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

/**
 * 27/8/2026 (R014) — I PASSAGGI LECITI, SCRITTI DOVE LI LEGGONO I PULSANTI.
 *
 * Chi può portare l'ordine da uno stato all'altro era scritto in un posto solo:
 * il guardiano `enforce_order_update_rules` della migrazione 114, dentro il
 * database. Nel sito la stessa conoscenza era riscritta a mano, una condizione
 * per pulsante, in due pagine diverse. Bastava che una condizione e il
 * guardiano si allontanassero di un passo perché il negoziante vedesse un
 * pulsante che al clic risponde «Non hai i permessi per questa azione»: un
 * messaggio che non c'entra niente con quello che ha fatto.
 *
 * Qui c'è la copia leggibile dal sito. Che sia la stessa del database lo
 * verifica `tests/unit/i-passaggi-di-stato-dell-ordine-hanno-una-casa-sola.test.ts`,
 * che legge la migrazione 114 e confronta i due elenchi.
 */
export type ChiCambiaStato = 'negoziante' | 'fattorino';

export const PASSAGGI_LECITI: { da: OrderStatus; a: OrderStatus; chi: ChiCambiaStato }[] = [
  { da: 'NEW',       a: 'ACCEPTED',         chi: 'negoziante' },
  { da: 'ACCEPTED',  a: 'READY',            chi: 'negoziante' },
  { da: 'READY',     a: 'ASSIGNED',         chi: 'fattorino'  },
  { da: 'PICKED_UP', a: 'OUT_FOR_DELIVERY', chi: 'fattorino'  },
];

/** Vero se quel passaggio lo può fare quella persona (le altre strade passano dalle RPC). */
export function passaggioLecito(da: OrderStatus, a: OrderStatus, chi: ChiCambiaStato): boolean {
  return PASSAGGI_LECITI.some((p) => p.da === da && p.a === a && p.chi === chi);
}

/** Gli stati d'arrivo possibili da qui: è l'elenco dei pulsanti da mostrare. */
export function passaggiDa(da: OrderStatus, chi: ChiCambiaStato): OrderStatus[] {
  return PASSAGGI_LECITI.filter((p) => p.da === da && p.chi === chi).map((p) => p.a);
}

/**
 * L'orario da segnare quando si arriva in quello stato.
 *
 * 27/8/2026 (R015) — Il nome della colonna lo passava il browser, dal punto in
 * cui si premeva il pulsante. La pagina gemella del fattorino era già stata
 * riparata («lasciava scrivere al BROWSER il nome di una colonna e il suo
 * valore»), quella del negoziante no: stessa forma già giudicata sbagliata, a
 * venti righe di distanza. Oggi il database para il colpo — accetta solo le
 * colonne del suo elenco — ma la colonna la decide lo stato d'arrivo, non chi
 * clicca. Gli orari di ritiro e consegna non sono qui apposta: quelli li scrive
 * il database dentro le sue funzioni, ed è giusto così — sono la prova di
 * quando è successo, e la prova non la scrive chi ha interesse a spostarla.
 */
export const COLONNA_ORARIO_DEL_PASSAGGIO: Partial<Record<OrderStatus, 'accepted_at' | 'ready_at'>> = {
  ACCEPTED: 'accepted_at',
  READY:    'ready_at',
};

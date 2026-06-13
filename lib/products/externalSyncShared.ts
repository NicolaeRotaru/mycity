/**
 * Logica pura (niente server-only / AI / DB) della sincronizzazione dei prodotti
 * importati da marketplace esterni. Separata da `externalSync.ts` per essere
 * testabile in isolamento e importabile (come tipo) anche da componenti client.
 */

export type Marketplace = 'ebay' | 'amazon' | 'aliexpress' | 'other';
export const MARKETPLACES: readonly Marketplace[] = ['ebay', 'amazon', 'aliexpress', 'other'] as const;

/** Oltre questo tempo lo snapshot è "stale" e va rinfrescato. */
export const EXTERNAL_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export type Availability = 'in_stock' | 'out_of_stock' | 'unknown';

/** Snapshot dati esterni salvato in `products.external_data`. */
export type ExternalData = {
  price: number | null;
  currency: string | null;
  delivery_min_days: number | null;
  delivery_max_days: number | null;
  delivery_label: string | null;
  availability: Availability;
  source_title: string | null;
  fetched_at: string;
};

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Costruisce un'etichetta consegna leggibile dai giorni min/max. */
export function deliveryLabelFrom(input: {
  delivery_label?: string;
  delivery_min_days?: number;
  delivery_max_days?: number;
}): string | null {
  if (typeof input.delivery_label === 'string' && input.delivery_label.trim()) return input.delivery_label.trim();
  const min = num(input.delivery_min_days);
  const max = num(input.delivery_max_days);
  if (min != null && max != null) return min === max ? `${min} giorni` : `${min}-${max} giorni`;
  if (max != null) return `${max} giorni`;
  if (min != null) return `${min}+ giorni`;
  return null;
}

/** Snapshot scaduto? (true anche se mai sincronizzato o data non valida). */
export function isStale(syncedAt: string | null | undefined, ttlMs: number = EXTERNAL_TTL_MS): boolean {
  if (!syncedAt) return true;
  const t = new Date(syncedAt).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t >= ttlMs;
}

/** Normalizza un'etichetta per il confronto (minuscolo, senza accenti). */
export function normalizeLabel(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

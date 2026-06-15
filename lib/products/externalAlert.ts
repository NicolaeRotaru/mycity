// lib/products/externalAlert.ts
import type { Availability, ExternalData } from '@/lib/products/externalSyncShared';

/**
 * Logica pura per gli alert sui prodotti importati: confronta lo snapshot
 * esterno precedente con quello appena recuperato e decide se c'è un cambiamento
 * degno di nota (prezzo o disponibilità) da notificare al venditore. Separata dal
 * cron per essere testabile in isolamento.
 */

/** Variazione di prezzo minima (relativa) per generare un alert. */
export const PRICE_PCT_THRESHOLD = 0.01; // 1%

export type ExternalDelta = {
  priceChanged: boolean;
  oldPrice: number | null;
  newPrice: number | null;
  pricePct: number | null;
  availabilityChanged: boolean;
  oldAvailability: Availability;
  newAvailability: Availability;
};

/**
 * Ritorna il delta se c'è un cambiamento notevole, altrimenti null. Il prezzo è
 * "notevole" se varia di almeno PRICE_PCT_THRESHOLD; la disponibilità se passa a
 * un valore noto diverso (ignora 'unknown', che non è un'informazione).
 */
export function detectExternalChange(
  prev: Pick<ExternalData, 'price' | 'availability'>,
  next: { price: number | null; availability: Availability },
): ExternalDelta | null {
  const oldPrice = prev.price ?? null;
  const newPrice = next.price ?? null;
  let priceChanged = false;
  let pricePct: number | null = null;
  if (oldPrice != null && newPrice != null && oldPrice > 0) {
    pricePct = (newPrice - oldPrice) / oldPrice;
    priceChanged = Math.abs(pricePct) >= PRICE_PCT_THRESHOLD;
  }

  const oldAvailability: Availability = prev.availability ?? 'unknown';
  const newAvailability: Availability = next.availability ?? 'unknown';
  const availabilityChanged = newAvailability !== 'unknown' && oldAvailability !== newAvailability;

  if (!priceChanged && !availabilityChanged) return null;
  return { priceChanged, oldPrice, newPrice, pricePct, availabilityChanged, oldAvailability, newAvailability };
}

/** Costruisce titolo e corpo della notifica per un delta. */
export function changeMessage(productName: string, d: ExternalDelta): { title: string; body: string } {
  const parts: string[] = [];
  if (d.priceChanged && d.oldPrice != null && d.newPrice != null) {
    const dir = d.newPrice > d.oldPrice ? 'aumentato' : 'sceso';
    parts.push(`prezzo alla fonte ${dir} da €${d.oldPrice.toFixed(2)} a €${d.newPrice.toFixed(2)}`);
  }
  if (d.availabilityChanged) {
    parts.push(
      d.newAvailability === 'out_of_stock'
        ? 'ora risulta esaurito alla fonte'
        : 'di nuovo disponibile alla fonte',
    );
  }
  return {
    title: `Aggiornamento su "${productName}"`,
    body: `Il prodotto importato ha cambiamenti: ${parts.join('; ')}. Valuta se aggiornare prezzo o disponibilità.`,
  };
}

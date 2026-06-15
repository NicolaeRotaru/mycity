import type { SupabaseClient } from '@supabase/supabase-js';
import { ALLOWED_IMAGE_TYPES } from '@/lib/products/uploadImages';

/**
 * Ri-ospita su storage le immagini importate da un marketplace.
 *
 * L'import da link recupera URL di foto esterne (CDN Amazon/eBay/…): invece di
 * lasciarle in hotlink (fragili, fuori dal nostro controllo) le scarichiamo e
 * le ricarichiamo nel bucket pubblico `products`, così le foto del prodotto
 * sono copie nostre. Operazione server-only (richiede fetch + service role).
 *
 * Fail-soft: se una singola immagine non si scarica/carica, viene segnalata in
 * `failed` e si prosegue con le altre (mai throw per un singolo URL).
 */

/** Estensione file dal content-type immagine (default jpg). */
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

export type RehostResult = {
  /** URL pubblici delle immagini ri-ospitate (solo quelle riuscite, in ordine). */
  urls: string[];
  /** Immagini non copiate, con il motivo. */
  failed: { url: string; reason: string }[];
};

export type RehostOpts = {
  /** Numero massimo di immagini da ri-ospitare. Default 10. */
  maxCount?: number;
  /** Dimensione massima per immagine (byte). Default 8 MiB. */
  maxBytes?: number;
  /** Timeout per il download di ogni immagine (ms). Default 10s. */
  timeoutMs?: number;
};

/** Solo http(s): blocca data:, file:, indirizzi interni via schema. */
function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Scarica `imageUrls` e le ricarica nel bucket `products` sotto `ownerId/`.
 * `storage` può essere il client admin (service role) o quello utente.
 */
export async function rehostImageUrls(
  storage: SupabaseClient,
  ownerId: string,
  imageUrls: string[],
  opts: RehostOpts = {},
): Promise<RehostResult> {
  const maxCount = opts.maxCount ?? 10;
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const urls: string[] = [];
  const failed: { url: string; reason: string }[] = [];

  // Dedupe + solo http(s) + cap conteggio.
  const seen = new Set<string>();
  const candidates = imageUrls
    .filter((u) => typeof u === 'string' && isHttpUrl(u) && !seen.has(u) && (seen.add(u), true))
    .slice(0, maxCount);

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          // Alcuni CDN rifiutano la UA di default di fetch.
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          accept: 'image/avif,image/webp,image/png,image/jpeg,*/*',
        },
      });
      if (!res.ok) {
        failed.push({ url, reason: `HTTP ${res.status}` });
        continue;
      }

      const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.includes(contentType) && !EXT_BY_TYPE[contentType]) {
        failed.push({ url, reason: `Tipo non supportato (${contentType || 'sconosciuto'})` });
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength === 0) {
        failed.push({ url, reason: 'File vuoto' });
        continue;
      }
      if (buffer.byteLength > maxBytes) {
        failed.push({ url, reason: 'Immagine troppo grande' });
        continue;
      }

      const ext = EXT_BY_TYPE[contentType] ?? 'jpg';
      const path = `${ownerId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await storage.storage.from('products').upload(path, buffer, {
        cacheControl: '3600',
        upsert: false,
        contentType,
      });
      if (upErr) {
        failed.push({ url, reason: upErr.message });
        continue;
      }
      const { data } = storage.storage.from('products').getPublicUrl(path);
      urls.push(data.publicUrl);
    } catch (err) {
      failed.push({ url, reason: err instanceof Error ? err.message : 'Errore download' });
    }
  }

  return { urls, failed };
}

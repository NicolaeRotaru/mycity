import type { SupabaseClient } from '@supabase/supabase-js';
import { ALLOWED_IMAGE_TYPES } from '@/lib/products/uploadImages';
import { safeImageFetch } from '@/lib/net/ssrf-guard';
import { caricaImmagine } from '@/lib/storage/carica-immagine';

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
 * Legge il corpo della risposta a pezzi e si ferma appena supera `maxBytes`.
 * Restituisce `null` se il tetto viene superato: così il file grande non arriva
 * mai a occupare la memoria per intero.
 *
 * Se la risposta non offre uno stream (per esempio in un test con una risposta
 * finta), ricade su arrayBuffer e controlla la dimensione subito dopo.
 */
export async function leggiConTetto(res: Response, maxBytes: number): Promise<Buffer | null> {
  const body = res.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  }

  const reader = body.getReader();
  const pezzi: Uint8Array[] = [];
  let letti = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      letti += value.byteLength;
      if (letti > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      pezzi.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(pezzi.map((p) => Buffer.from(p)));
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
      // Fetch SSRF-safe: blocca IP interni/metadata e i redirect verso
      // destinazioni interne (un singolo URL malevolo viene segnalato in
      // `failed`, fail-soft, senza far fallire l'intero import).
      const res = await safeImageFetch(url, { timeoutMs });
      if (!res.ok) {
        failed.push({ url, reason: `HTTP ${res.status}` });
        continue;
      }

      const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.includes(contentType) && !EXT_BY_TYPE[contentType]) {
        failed.push({ url, reason: `Tipo non supportato (${contentType || 'sconosciuto'})` });
        continue;
      }

      // Il tetto si controlla PRIMA di tenere il file in memoria. Con
      // `await res.arrayBuffer()` il controllo arrivava quando il file era già
      // interamente in RAM: un URL che punta a un file enorme — e l'URL lo
      // scrive il venditore — bastava a saturare la memoria del server.
      const dichiarati = Number(res.headers.get('content-length') ?? '');
      if (Number.isFinite(dichiarati) && dichiarati > maxBytes) {
        failed.push({ url, reason: 'Immagine troppo grande' });
        continue;
      }

      // Chi mente sul Content-Length (o lo omette) viene fermato comunque:
      // si legge a pezzi e si interrompe appena si supera il tetto.
      const buffer = await leggiConTetto(res, maxBytes);
      if (buffer === null) {
        failed.push({ url, reason: 'Immagine troppo grande' });
        continue;
      }
      if (buffer.byteLength === 0) {
        failed.push({ url, reason: 'File vuoto' });
        continue;
      }

      // Qui il corpo e' un Buffer scaricato, non un File: il nome serve solo per l'estensione,
      // quindi glielo diamo noi dal tipo dichiarato. La cartella la decide comunque la porta.
      const ext = EXT_BY_TYPE[contentType] ?? 'jpg';
      const corpo = Object.assign(buffer, { name: `img.${ext}`, type: contentType });
      let publicUrl: string;
      try {
        ({ publicUrl } = await caricaImmagine(storage, {
          file: corpo,
          userId: ownerId,
          cacheControl: '3600',
          contentType,
        }));
      } catch (e) {
        failed.push({ url, reason: e instanceof Error ? e.message : 'Errore caricamento' });
        continue;
      }
      urls.push(publicUrl);
    } catch (err) {
      failed.push({ url, reason: err instanceof Error ? err.message : 'Errore download' });
    }
  }

  return { urls, failed };
}

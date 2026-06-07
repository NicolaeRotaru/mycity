import { env } from '@/lib/env';
import {
  type BgInput,
  type BgResult,
  type BgRemovalProvider,
  BgRemovalConfigError,
  BgRemovalRateLimitError,
  BgRemovalUpstreamError,
} from './types';

/**
 * Provider rimozione sfondo — adapter pattern (come lib/kyc/providers.ts).
 *
 * Decisione utente: la rimozione gira LATO SERVER via API a pagamento. Il client
 * invia la foto, riceve indietro l'immagine su sfondo bianco e la ricarica su
 * Storage. Factory fail-closed in produzione: senza provider reale → 503.
 */

/**
 * Mock: ritorna l'immagine invariata. Solo dev/CI (nessun costo, nessuna chiave).
 * NON viene mai usato in produzione (vedi getBgRemovalProvider).
 */
class MockBgRemovalProvider implements BgRemovalProvider {
  async removeBackground(input: BgInput): Promise<BgResult> {
    return { base64: input.base64, mediaType: input.mediaType };
  }
}

/**
 * remove.bg (https://www.remove.bg/api).
 *
 * `bg_color=ffffff` → remove.bg compone il soggetto su BIANCO opaco e ritorna
 * direttamente l'immagine finale (niente compositing lato client). Richiesta
 * form-encoded con `image_file_b64`; risposta BINARIA (l'immagine), non JSON.
 */
class RemoveBgProvider implements BgRemovalProvider {
  constructor(private apiKey: string) {}

  async removeBackground(input: BgInput): Promise<BgResult> {
    const form = new URLSearchParams();
    form.set('image_file_b64', input.base64);
    form.set('bg_color', 'ffffff'); // sfondo bianco uniforme
    form.set('size', 'auto');       // miglior risoluzione disponibile col credito

    let res: Response;
    try {
      res = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: { 'X-Api-Key': this.apiKey },
        body: form,
      });
    } catch {
      // Errore di rete: mai loggare la chiave o il body.
      throw new BgRemovalUpstreamError('Servizio remove.bg non raggiungibile.');
    }

    if (!res.ok) {
      // Solo lo status: il body d'errore puo' contenere dettagli sensibili.
      if (res.status === 402 || res.status === 403) {
        // Credito esaurito / chiave non valida → problema di configurazione server.
        throw new BgRemovalConfigError('Servizio rimozione sfondo non disponibile (credito o chiave).');
      }
      if (res.status === 429) throw new BgRemovalRateLimitError();
      throw new BgRemovalUpstreamError(`remove.bg HTTP ${res.status}`, res.status);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const mediaType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
    return { base64: buf.toString('base64'), mediaType };
  }
}

/**
 * Photoroom Image Editing API v2 (https://www.photoroom.com/api).
 * `background.color=FFFFFF` → soggetto su bianco. Richiesta multipart, risposta
 * binaria. Alternativa a remove.bg con lo stesso contratto (immagine su bianco).
 */
class PhotoroomProvider implements BgRemovalProvider {
  constructor(private apiKey: string) {}

  async removeBackground(input: BgInput): Promise<BgResult> {
    const bytes = Buffer.from(input.base64, 'base64');
    const form = new FormData();
    form.set('imageFile', new Blob([bytes], { type: input.mediaType }), 'product');
    form.set('background.color', 'FFFFFF');

    let res: Response;
    try {
      res = await fetch('https://image-api.photoroom.com/v2/edit', {
        method: 'POST',
        headers: { 'x-api-key': this.apiKey },
        body: form,
      });
    } catch {
      throw new BgRemovalUpstreamError('Servizio Photoroom non raggiungibile.');
    }

    if (!res.ok) {
      if (res.status === 402 || res.status === 403) {
        throw new BgRemovalConfigError('Servizio rimozione sfondo non disponibile (credito o chiave).');
      }
      if (res.status === 429) throw new BgRemovalRateLimitError();
      throw new BgRemovalUpstreamError(`Photoroom HTTP ${res.status}`, res.status);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const mediaType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
    return { base64: buf.toString('base64'), mediaType };
  }
}

/**
 * Factory. Fail-closed in produzione: 'mock' in prod o provider reale senza
 * chiave → BgRemovalConfigError (la route risponde 503). 'mock' resta solo per
 * dev/CI.
 */
export function getBgRemovalProvider(): BgRemovalProvider {
  const which = env.bgRemovalProvider();

  if (which === 'removebg') {
    const key = env.removeBgApiKey();
    if (!key) throw new BgRemovalConfigError();
    return new RemoveBgProvider(key);
  }

  if (which === 'photoroom') {
    const key = env.photoroomApiKey();
    if (!key) throw new BgRemovalConfigError();
    return new PhotoroomProvider(key);
  }

  // which === 'mock'
  if (process.env.NODE_ENV === 'production') throw new BgRemovalConfigError();
  return new MockBgRemovalProvider();
}

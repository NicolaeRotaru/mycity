/**
 * Rimozione sfondo foto prodotto — tipi e contratto provider.
 *
 * Contratto: un provider riceve un'immagine (base64) e RITORNA SEMPRE il base64
 * di un'immagine con il prodotto su SFONDO BIANCO UNIFORME. Il compositing del
 * bianco e' responsabilita' del provider (es. remove.bg con bg_color=ffffff),
 * cosi' il client resta "dumb" e mostra/carica direttamente il risultato.
 */

export type BgInput = {
  /** Immagine sorgente in base64 (senza prefisso data:). */
  base64: string;
  /** MIME dell'immagine sorgente. */
  mediaType: string;
};

export type BgResult = {
  /** Immagine su sfondo bianco in base64 (senza prefisso data:). */
  base64: string;
  /** MIME dell'immagine risultante. */
  mediaType: string;
};

export interface BgRemovalProvider {
  removeBackground(input: BgInput): Promise<BgResult>;
}

/**
 * Provider non configurato (chiave mancante, oppure 'mock' in produzione) o
 * credito esaurito lato provider. La route mappa questo errore a 503.
 */
export class BgRemovalConfigError extends Error {
  constructor(message = 'Servizio rimozione sfondo non configurato.') {
    super(message);
    this.name = 'BgRemovalConfigError';
  }
}

/** Rate limit lato provider upstream. La route mappa a 429. */
export class BgRemovalRateLimitError extends Error {
  constructor(message = 'Troppe richieste al servizio di rimozione sfondo.') {
    super(message);
    this.name = 'BgRemovalRateLimitError';
  }
}

/** Errore generico upstream (immagine non valida, 5xx, ecc.). La route mappa a 502. */
export class BgRemovalUpstreamError extends Error {
  status?: number;
  constructor(message = 'Errore del servizio di rimozione sfondo.', status?: number) {
    super(message);
    this.name = 'BgRemovalUpstreamError';
    this.status = status;
  }
}

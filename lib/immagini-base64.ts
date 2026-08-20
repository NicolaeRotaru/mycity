/**
 * Un solo posto dove si decide se una foto caricata è davvero una foto.
 *
 * Il difetto (#207): il controllo del formato guardava i primi 4096 caratteri
 * della stringa e si fermava lì. Una richiesta poteva mandare quattromila
 * caratteri innocui seguiti da sette megabyte di qualunque cosa: passava il
 * controllo e finiva dentro una chiamata a pagamento, o dentro il provider di
 * rimozione sfondo. E nessuno verificava che il tipo dichiarato — «questa è una
 * jpeg» — corrispondesse al contenuto.
 *
 * Costava anche tre copie della stessa regola in tre file, già divergenti.
 *
 * Qui la stringa si controlla tutta (una regex su sette megabyte costa
 * pochissimo rispetto a una chiamata di rete a pagamento) e si guardano i primi
 * byte veri, quelli che dicono che tipo di immagine è.
 */

export const TIPI_IMMAGINE = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type TipoImmagine = (typeof TIPI_IMMAGINE)[number];

/** base64 ≈ 4/3 dei byte veri: ~7,5 MB di stringa = ~5 MB di immagine. */
export const MAX_LUNGHEZZA_BASE64 = 7_500_000;

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export type EsitoImmagine = { ok: true } | { ok: false; motivo: string; troppoGrande?: boolean };

/** I primi byte dicono il tipo vero, comunque sia stato dichiarato. */
function tipoDaiPrimiByte(dati: string): TipoImmagine | null {
  let testa: Buffer;
  try {
    // 24 caratteri base64 = 18 byte: bastano per tutte e tre le firme.
    testa = Buffer.from(dati.slice(0, 24), 'base64');
  } catch {
    return null;
  }
  if (testa.length >= 3 && testa[0] === 0xff && testa[1] === 0xd8 && testa[2] === 0xff) return 'image/jpeg';
  if (
    testa.length >= 8 &&
    testa[0] === 0x89 && testa[1] === 0x50 && testa[2] === 0x4e && testa[3] === 0x47 &&
    testa[4] === 0x0d && testa[5] === 0x0a && testa[6] === 0x1a && testa[7] === 0x0a
  ) return 'image/png';
  if (
    testa.length >= 12 &&
    testa.toString('ascii', 0, 4) === 'RIFF' &&
    testa.toString('ascii', 8, 12) === 'WEBP'
  ) return 'image/webp';
  return null;
}

/**
 * Verifica una immagine ricevuta come base64: alfabeto, dimensione e
 * corrispondenza fra tipo dichiarato e contenuto reale.
 */
export function verificaImmagineBase64(dati: unknown, tipoDichiarato: string): EsitoImmagine {
  if (typeof dati !== 'string' || dati.length === 0) {
    return { ok: false, motivo: 'image_base64 mancante.' };
  }
  if (dati.length > MAX_LUNGHEZZA_BASE64) {
    return { ok: false, motivo: 'Immagine troppo grande. Massimo 5 MB.', troppoGrande: true };
  }
  if (!BASE64_RE.test(dati)) {
    return { ok: false, motivo: 'image_base64 non è un valore base64 valido.' };
  }
  const tipoVero = tipoDaiPrimiByte(dati);
  if (!tipoVero) {
    return { ok: false, motivo: 'Il file caricato non è una immagine JPEG, PNG o WebP.' };
  }
  if (tipoVero !== tipoDichiarato) {
    return { ok: false, motivo: `Il file dichiarato ${tipoDichiarato} in realtà è ${tipoVero}.` };
  }
  return { ok: true };
}

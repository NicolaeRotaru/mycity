/**
 * 22/8/2026 — I PRIMI BYTE DEL FILE, NON QUELLO CHE DICE CHI LO MANDA.
 *
 * Il tipo di un file caricato arriva da un'intestazione che scrive il
 * chiamante. Un file qualunque presentato come `image/jpeg` passava la lista
 * dei tipi ammessi senza che nessuno guardasse dentro.
 *
 * Ogni formato ha una firma: i suoi primi byte sono sempre gli stessi. Quella
 * non si dichiara — c'è o non c'è.
 */

export type TipoAmmesso = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

/**
 * L'estensione si ricava dal tipo GIÀ verificato, con una mappa chiusa.
 *
 * Prima si prendeva tutto quello che seguiva l'ultimo punto del nome del file,
 * senza lista bianca, e lo si infilava nel percorso di salvataggio: il nome
 * scelto da chi carica finiva a decidere come si chiama il file sul nostro
 * archivio.
 */
export const ESTENSIONE_PER_TIPO: Record<TipoAmmesso, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Le firme: sequenze di byte all'inizio del file. `null` = qualunque valore. */
const FIRME: Record<TipoAmmesso, Array<Array<number | null>>> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  // WEBP: "RIFF" · quattro byte di lunghezza (qualunque) · "WEBP"
  'image/webp': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]], // "%PDF-"
};

function combacia(byte: Uint8Array, firma: Array<number | null>): boolean {
  if (byte.length < firma.length) return false;
  return firma.every((atteso, i) => atteso === null || byte[i] === atteso);
}

/**
 * Dice se i primi byte del file corrispondono davvero al tipo dichiarato.
 * Un tipo fuori dalla lista è `false` per definizione: non lo accettiamo.
 */
export function laFirmaCombacia(byte: Uint8Array, tipoDichiarato: string): boolean {
  const firme = FIRME[tipoDichiarato as TipoAmmesso];
  if (!firme) return false;
  return firme.some((f) => combacia(byte, f));
}

/** Il tipo vero, letto dai byte. `null` se non è nessuno di quelli ammessi. */
export function tipoDaiPrimiByte(byte: Uint8Array): TipoAmmesso | null {
  for (const tipo of Object.keys(FIRME) as TipoAmmesso[]) {
    if (FIRME[tipo].some((f) => combacia(byte, f))) return tipo;
  }
  return null;
}

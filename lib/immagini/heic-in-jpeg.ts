/**
 * LE FOTO HEIC/HEIF DIVENTANO JPEG PRIMA DI PARTIRE, OPPURE NON PARTONO.
 *
 * ── Il difetto ───────────────────────────────────────────────────────────────────────────────
 * I magazzini delle foto accettano HEIC e HEIF (`lib/storage/regole-secchi.ts`), cioè il formato
 * con cui l'iPhone scatta. Ma nessuno li convertiva: il file si salvava così com'era e si mostrava
 * con un normale <img>. Chi carica, dal suo iPhone, la vedeva bene; i clienti su Chrome, Firefox,
 * Edge e sui telefoni Android vedevano un riquadro rotto. Nove caselle di caricamento lo facevano.
 *
 * ── La cura, in due mosse ────────────────────────────────────────────────────────────────────
 *   ① il campo file non chiede HEIC al telefono (`acceptSenzaHeic`): così, scegliendo dalla
 *     galleria, l'iPhone la trasforma da solo in JPEG, su qualunque versione di iOS;
 *   ② l'HEIC che arriva lo stesso — trascinato da un computer, scelto con «tutti i file», col tipo
 *     vuoto come lo consegnano Windows e Android — passa da `senzaHeic` prima del caricamento:
 *     dove il browser lo sa leggere (Safari su Mac e iPhone, da dove arrivano gli HEIC) diventa un
 *     JPEG; dove non lo sa leggere si rifiuta con una frase chiara (`avvisoFotoHeic`), e non parte.
 *
 * ── Il tetto della tela ──────────────────────────────────────────────────────────────────────
 * Safari su iPhone non disegna una tela più grande di 16.777.216 pixel (4096 × 4096): una foto da
 * 24 MP di un iPhone recente la supera, e la conversione falliva proprio sul telefono da cui gli
 * HEIC arrivano. Qui il lato lungo si porta a 4096 al massimo, quindi la tela resta sempre sotto il
 * tetto; le foto si mostrano comunque molto più piccole.
 *
 * 🟢 Nessuna libreria: il browser decodifica (`createImageBitmap`, o un <img>) e la tela codifica.
 */

/** Il lato lungo massimo della foto convertita: 4096 × 4096 è il tetto della tela di Safari. */
const LATO_MASSIMO = 4096;
const QUALITA_JPEG = 0.9;

const HEIC_NEL_TIPO = /^image\/hei[cf](?:-sequence)?$/i;
const HEIC_NEL_NOME = /\.hei[cf]$/i;

/** HEIC o HEIF, dal tipo dichiarato («image/heic») o, se il tipo è vuoto, dal nome («IMG_0421.HEIC»). */
export function eFotoHeic(file: { name?: string | null; type?: string | null } | null | undefined): boolean {
  return HEIC_NEL_TIPO.test(String(file?.type ?? '').trim()) || HEIC_NEL_NOME.test(String(file?.name ?? '').trim());
}

/**
 * L'attributo `accept` del campo file senza HEIC/HEIF, da una stringa («image/jpeg,image/heic») o
 * dalla mappa di react-dropzone. Con HEIC nell'elenco l'iPhone consegna l'originale invece di
 * trasformarlo da solo in JPEG.
 */
export function acceptSenzaHeic(accept: string | Readonly<Record<string, readonly string[]>>): string {
  const voci = typeof accept === 'string'
    ? accept.split(',')
    : Object.entries(accept).flatMap(([tipo, estensioni]) => [tipo, ...estensioni]);
  return voci.map((v) => v.trim()).filter((v) => v && !/hei[cf]/i.test(v)).join(',');
}

/** La frase per chi carica, quando il browser non sa convertire la foto. */
export function avvisoFotoHeic(quante = 1): string {
  return quante > 1
    ? `${quante} foto sono in formato HEIC (quello dell'iPhone) e questo browser non le sa convertire: così come sono, su Chrome e sui telefoni Android si vedrebbe un riquadro vuoto. Salvale in JPG e riprova, oppure caricale direttamente dall'iPhone, che le trasforma da solo.`
    : "Questa foto è in formato HEIC (quello dell'iPhone) e questo browser non la sa convertire: così com'è, su Chrome e sui telefoni Android si vedrebbe un riquadro vuoto. Salvala in JPG e riprova, oppure caricala direttamente dall'iPhone, che la trasforma da solo.";
}

type Decodificata = { larghezza: number; altezza: number; sorgente: CanvasImageSource; libera: () => void };

/** La foto letta dal browser, o `null` se non la sa leggere (Chrome, Firefox ed Edge con un HEIC). */
async function decodifica(file: File): Promise<Decodificata | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return { larghezza: bitmap.width, altezza: bitmap.height, sorgente: bitmap, libera: () => bitmap.close?.() };
      }
      bitmap.close?.();
    } catch {
      // Non la sa leggere così: si prova con un <img>, che su qualche Safari legge di più.
    }
  }
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const img = document.createElement('img');
  // Senza `decode` non c'è un modo sicuro di sapere quando ha finito (o se ha fallito): niente attese a vuoto.
  if (typeof img.decode !== 'function') return null;
  const indirizzo = URL.createObjectURL(file);
  try {
    img.src = indirizzo;
    await img.decode();
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      return { larghezza: img.naturalWidth, altezza: img.naturalHeight, sorgente: img, libera: () => URL.revokeObjectURL(indirizzo) };
    }
  } catch {
    // il browser non sa leggere questo file
  }
  URL.revokeObjectURL(indirizzo);
  return null;
}

/** «IMG_0421.HEIC» → «IMG_0421.jpg». */
function nomeJpg(nome: string): string {
  return `${String(nome ?? '').trim().replace(HEIC_NEL_NOME, '') || 'foto'}.jpg`;
}

/**
 * Il file pronto da caricare: lo stesso file se non è un HEIC/HEIF, un JPEG (`image/jpeg`, nome
 * che finisce in `.jpg`) se il browser lo sa convertire, `null` se non ci riesce. Con `null` il
 * file non si carica: si mostra `avvisoFotoHeic()`.
 */
export async function senzaHeic(file: File): Promise<File | null> {
  if (!eFotoHeic(file)) return file;
  const foto = await decodifica(file);
  if (!foto) return null;
  try {
    const scala = Math.min(1, LATO_MASSIMO / Math.max(foto.larghezza, foto.altezza));
    const larghezza = Math.max(1, Math.round(foto.larghezza * scala));
    const altezza = Math.max(1, Math.round(foto.altezza * scala));
    const tela = document.createElement('canvas');
    tela.width = larghezza;
    tela.height = altezza;
    const ctx = tela.getContext('2d');
    if (!ctx) return null;
    // Il JPEG non ha trasparenza: senza fondo i pixel trasparenti diventerebbero neri.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, larghezza, altezza);
    ctx.drawImage(foto.sorgente, 0, 0, larghezza, altezza);
    const jpeg = await new Promise<Blob | null>((fatto) => tela.toBlob(fatto, 'image/jpeg', QUALITA_JPEG));
    // Safari tiene la memoria della tela finché esiste: azzerarla la libera subito.
    tela.width = 0;
    tela.height = 0;
    if (!jpeg || jpeg.size === 0) return null;
    return new File([jpeg], nomeJpg(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return null;
  } finally {
    foto.libera();
  }
}

/**
 * Più file insieme, uno alla volta (una foto da 24 MP decodificata occupa circa 100 MB: tutte
 * insieme un telefono non le regge). `pronte` sono da caricare, nell'ordine; `rifiutate` sono gli
 * HEIC che questo browser non sa convertire.
 */
export async function tutteSenzaHeic(files: readonly File[]): Promise<{ pronte: File[]; rifiutate: File[] }> {
  const pronte: File[] = [];
  const rifiutate: File[] = [];
  for (const file of files) {
    const pronta = await senzaHeic(file);
    if (pronta) pronte.push(pronta);
    else rifiutate.push(file);
  }
  return { pronte, rifiutate };
}

/**
 * Ridimensionamento immagini lato client (browser-only: usa Image/canvas).
 *
 * Estratto da components/seller/PhotoFillButton.tsx per essere riusato anche
 * dalla rimozione sfondo (BackgroundRemovalPreview), che ha bisogno di una
 * risoluzione piu' alta (la foto risultante viene salvata e mostrata al cliente).
 *
 * Caricare l'immagine via data:-URL (FileReader) e non con <img crossorigin>
 * evita il "tainted canvas": toDataURL funziona anche su sorgenti cross-origin.
 */

const DEFAULT_MAX_DIMENSION = 1024;

/**
 * Carica un Blob immagine e lo disegna su un canvas, riscalato in modo che il
 * lato piu' lungo non superi `maxDimension` (non ingrandisce mai). Logica
 * condivisa tra l'output base64 (per l'AI) e l'output File (per l'upload).
 */
async function drawToCanvas(file: Blob, maxDimension: number): Promise<HTMLCanvasElement> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Lettura file fallita'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Immagine non valida'));
    i.src = dataUrl;
  });

  const ratio = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas non supportato');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

export async function resizeImageToBase64(
  file: Blob,
  maxDimension: number = DEFAULT_MAX_DIMENSION,
  quality = 0.85,
): Promise<{ base64: string; mediaType: string }> {
  const canvas = await drawToCanvas(file, maxDimension);
  // Forziamo JPEG: piu' piccolo del PNG (e supportato ovunque).
  const outDataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = outDataUrl.split(',')[1] ?? '';
  return { base64, mediaType: 'image/jpeg' };
}

/**
 * Ricomprime/riscala un'immagine restituendo un nuovo File JPEG, pronto per
 * l'upload sullo storage. Le foto da smartphone superano spesso i limiti di
 * dimensione del bucket: invece di rifiutarle, le riportiamo a una risoluzione
 * ragionevole (default 1600px lato lungo) cosi' restano sotto i 5 MB.
 */
export async function resizeImageToFile(
  file: File,
  maxDimension = 1600,
  quality = 0.85,
): Promise<File> {
  const canvas = await drawToCanvas(file, maxDimension);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
  });
  if (!blob) throw new Error('Compressione immagine fallita');
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'foto';
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
}

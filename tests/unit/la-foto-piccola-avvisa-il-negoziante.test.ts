import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fotoTroppoPiccole, LATO_MINIMO_CONSIGLIATO } from '@/lib/products/uploadImages';

/**
 * LA FOTO DA 300 PIXEL ENTRAVA SENZA CHE NESSUNO DICESSE NIENTE (radiografia del 3/9/2026).
 *
 * Il controllo sulle foto prodotto esisteva solo verso l'alto: la dropzone rifiuta oltre i 30 MB,
 * l'upload ricomprime oltre i 5. Verso il basso, niente. Un negoziante che salva dal suo vecchio
 * sito una foto da 300 pixel la carica liscia, e quella foto finisce nella scheda prodotto dentro
 * un riquadro che sul computer arriva a 220 pixel e su telefono occupa quasi meta' larghezza:
 * sgranata proprio nel punto che deve far comprare. Lui non ha modo di accorgersene finche' non va
 * a guardarsi la sua pagina da cliente.
 *
 * La misura la fa il browser con `createImageBitmap`, che nei test non esiste (girano su node):
 * qui lo mettiamo noi, e la prova ESEGUE la funzione vera invece di leggere il sorgente.
 *
 * ⚠️ Il punto delicato non e' trovare le foto piccole: e' non fermare nessuno. Una foto piccola
 * vale piu' di nessuna foto, e un negozio che non riesce a pubblicare e' un negozio che smette.
 * Per questo la funzione non lancia mai e, quando non sa misurare, tace.
 */

// `createImageBitmap` e' del browser: qui i test girano su node e non c'e'. Lo mettiamo noi sul
// globale, passando da una vista con indice per non litigare coi tipi del DOM.
const g = globalThis as unknown as Record<string, unknown>;
const originale = g.createImageBitmap;

/** Finge il browser: ogni foto ha le dimensioni che le diamo qui. */
function browserCheMisura(dimensioni: Record<string, [number, number]>) {
  g.createImageBitmap = async (file: unknown) => {
    const misure = dimensioni[(file as { name: string }).name];
    if (!misure) throw new Error('file illeggibile');
    return { width: misure[0], height: misure[1], close: () => {} };
  };
}

const foto = (name: string) => ({ name }) as unknown as File;

afterEach(() => {
  if (originale === undefined) delete g.createImageBitmap;
  else g.createImageBitmap = originale;
});

describe('la foto sotto la soglia viene segnalata al negoziante', () => {
  it('la foto da 300 pixel salvata dal vecchio sito viene trovata', async () => {
    browserCheMisura({ 'vecchio-sito.jpg': [300, 225] });
    expect(await fotoTroppoPiccole([foto('vecchio-sito.jpg')])).toEqual(['vecchio-sito.jpg']);
  });

  it('la foto dello smartphone passa senza avvisi', async () => {
    browserCheMisura({ 'iphone.jpg': [3024, 4032] });
    expect(await fotoTroppoPiccole([foto('iphone.jpg')])).toEqual([]);
  });

  it('conta il lato LUNGO: una foto alta e stretta non e piccola', async () => {
    // 400x1200: larga poco, ma dentro il riquadro ci sta con i suoi pixel.
    browserCheMisura({ 'verticale.jpg': [400, 1200] });
    expect(await fotoTroppoPiccole([foto('verticale.jpg')])).toEqual([]);
  });

  it('sulla soglia esatta non si avvisa: 800 e la misura giusta, non quella sbagliata', async () => {
    browserCheMisura({ 'giusta.jpg': [LATO_MINIMO_CONSIGLIATO, 600] });
    expect(await fotoTroppoPiccole([foto('giusta.jpg')])).toEqual([]);
  });

  it('su piu foto torna solo i nomi di quelle piccole, nell ordine in cui sono state caricate', async () => {
    browserCheMisura({
      'a.jpg': [2000, 1500],
      'b.jpg': [640, 480],
      'c.jpg': [1200, 900],
      'd.jpg': [200, 200],
    });
    expect(await fotoTroppoPiccole([foto('a.jpg'), foto('b.jpg'), foto('c.jpg'), foto('d.jpg')])).toEqual([
      'b.jpg',
      'd.jpg',
    ]);
  });
});

describe('l avviso non puo mai bloccare un caricamento', () => {
  it('se il browser non sa misurare, non dice niente e non lancia', async () => {
    delete g.createImageBitmap;
    await expect(fotoTroppoPiccole([foto('qualsiasi.jpg')])).resolves.toEqual([]);
  });

  it('se una foto non si apre, le altre si misurano lo stesso', async () => {
    browserCheMisura({ 'buona.jpg': [100, 100] }); // 'rotta.jpg' non e' nella mappa → lancia
    expect(await fotoTroppoPiccole([foto('rotta.jpg'), foto('buona.jpg')])).toEqual(['buona.jpg']);
  });

  it('la soglia e 800: sotto si vede sgranata nel riquadro della scheda', () => {
    expect(LATO_MINIMO_CONSIGLIATO).toBe(800);
  });
});

describe('il campo foto usa davvero questo avviso', () => {
  // La funzione da sola non serve a niente se nessuno la chiama: qui si tiene insieme il pezzo che
  // misura e il pezzo che parla. Il componente non si monta qui (vuole React + dropzone), quindi
  // questa meta' legge il sorgente: e' l'invariante, ed e' rossa il giorno che l'avviso sparisce.
  const src = readFileSync(resolve(__dirname, '..', '..', 'components/seller/ProductImagesField.tsx'), 'utf8');

  it('ProductImagesField chiama fotoTroppoPiccole', () => {
    expect(src).toContain('fotoTroppoPiccole');
  });

  it('e lo dice come un avviso, non come un errore che sembra un rifiuto', () => {
    expect(src).toMatch(/toast\.warning\(/);
    expect(src, "il negoziante deve capire cosa vedra' il cliente").toMatch(/sgranat/i);
  });
});

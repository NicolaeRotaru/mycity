import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  fotoDiCategoria,
  motivoDaSegnalare,
  HOST_FOTO_AMMESSI,
  SUFFISSO_HOST_STORAGE,
} from '@/lib/immagine-categoria';

/**
 * 8/9/2026 (lotto gravi, corsia 17) — LE TESSERE DELLE CATEGORIE IN HOME ERANO
 * UNDICI FOTO D'ARCHIVIO SCRITTE A MANO NEL CODICE.
 *
 * Stavano in un elenco dentro `components/CategoryShowcase.tsx`, e il commento
 * sopra l'elenco lo diceva: «Scelte "a stima" e NON verificabili dalla
 * sandbox». Foto Pexels: le stesse che può avere in home qualunque sito del
 * mondo, su un mercato che si presenta come i negozi di Piacenza. Cambiarne una
 * voleva dire riscrivere il codice e ripubblicare il sito, perché la tabella
 * `categories` non aveva nessuna colonna per l'immagine.
 *
 * E c'era la seconda metà: quando una di quelle foto non caricava, la tessera
 * tornava un gradiente e l'immagine rotta veniva messa a `display:none`. Cioè
 * il guasto spariva anche per noi.
 *
 * Queste prove difendono il comportamento nuovo: la foto la decide il DATO
 * (`categories.image_url`), quando non c'è si vede il gradiente del marchio e
 * non una foto presa altrove, e un indirizzo inservibile torna col suo motivo
 * invece che come un `null` muto.
 */

const RADICE = path.resolve(__dirname, '../..');

describe('la foto di una tessera di categoria', () => {
  it('quando il dato non ha nessuna foto, non se ne inventa una: resta il gradiente', () => {
    const esito = fotoDiCategoria({ slug: 'alimentari' });

    expect(
      esito.src,
      'Senza foto nel dato la tessera deve restare il gradiente del marchio, non ripescare una foto d\'archivio dal codice',
    ).toBeNull();
    expect(esito.motivo).toBe('nessuna');
  });

  it('mostra la foto scritta nel dato: è così che si cambia senza ripubblicare il sito', () => {
    const suStorage = 'https://abcdefgh.supabase.co/storage/v1/object/public/categorie/alimentari.jpg';

    const esito = fotoDiCategoria({ slug: 'alimentari', image_url: suStorage });

    expect(
      esito.src,
      'La foto messa in categories.image_url deve arrivare a video: è tutto il punto della riparazione',
    ).toBe(suStorage);
    expect(esito.motivo).toBeNull();
    expect(motivoDaSegnalare(esito), 'Una foto valida non è un guasto: non va scritta nei log').toBeNull();
  });

  it('accetta anche un percorso del sito, per le foto che stiamo per caricare noi', () => {
    const esito = fotoDiCategoria({ slug: 'libri', image_url: '/immagini/categorie/libri.jpg' });

    expect(esito.src).toBe('/immagini/categorie/libri.jpg');
    expect(esito.motivo).toBeNull();
  });

  it('non si fa ingannare da «//altro-sito/foto.jpg», che sembra un percorso del sito e non lo è', () => {
    const esito = fotoDiCategoria({ slug: 'libri', image_url: '//sito-di-un-altro.example/foto.jpg' });

    expect(
      esito.src,
      'Un indirizzo protocol-relative è esterno: se passasse dal ramo «comincia per barra» finirebbe in pagina senza nessun controllo sul dominio',
    ).toBeNull();
    expect(esito.motivo).not.toBeNull();
  });

  it('non mette mai in pagina un indirizzo che non è un\'immagine', () => {
    const esito = fotoDiCategoria({ slug: 'sport', image_url: 'javascript:alert(1)' });

    expect(esito.src, 'javascript: dentro il src di un\'immagine non è una foto: è un tentativo').toBeNull();
    expect(esito.motivo).toBe('schema-non-ammesso');
    expect(
      motivoDaSegnalare(esito),
      'Un indirizzo scartato deve lasciare una frase da scrivere nei log, altrimenti torna il silenzio di prima',
    ).toContain('https://');
  });

  it('scarta un indirizzo su un sito che il browser bloccherebbe, e dice quale', () => {
    const esito = fotoDiCategoria({ slug: 'bellezza', image_url: 'https://cdn-di-un-altro.example/foto.jpg' });

    expect(
      esito.src,
      'La regola di sicurezza del sito non lascia caricare quel dominio: mandarlo in pagina vuol dire una tessera muta e nessuno che capisce perché',
    ).toBeNull();
    expect(esito.motivo).toBe('host-non-ammesso');
    expect(
      motivoDaSegnalare(esito),
      'Il log deve contenere l\'indirizzo da correggere, non solo «qualcosa non va»',
    ).toContain('cdn-di-un-altro.example');
  });

  it('tratta lo spazio bianco come un campo vuoto, senza gridare al guasto', () => {
    const esito = fotoDiCategoria({ slug: 'casa', image_url: '   ' });

    expect(esito.src).toBeNull();
    expect(esito.motivo).toBe('nessuna');
    expect(
      motivoDaSegnalare(esito),
      'Il campo vuoto è lo stato normale di oggi su tutte le categorie: se lo segnalassimo, il log direbbe sei volte per pagina una cosa che sappiamo già',
    ).toBeNull();
  });

  it('regge un dato storto — colonna assente, numero, null — senza far saltare la home', () => {
    expect(fotoDiCategoria(undefined).src).toBeNull();
    expect(fotoDiCategoria(null).src).toBeNull();
    expect(fotoDiCategoria({}).src).toBeNull();
    expect(fotoDiCategoria({ slug: 'x', image_url: 42 }).src).toBeNull();
    expect(fotoDiCategoria({ slug: 'x', image_url: null }).motivo).toBe('nessuna');
  });
});

/**
 * Le due prove qui sotto non guardano un comportamento: guardano che la malattia
 * non possa tornare a entrare dalla stessa porta. Sono la seconda cintura, non
 * la prova principale.
 */
describe('la malattia non può rientrare', () => {
  it('nel componente delle categorie non c\'è più nessun indirizzo di foto scritto a mano', () => {
    const sorgente = readFileSync(path.join(RADICE, 'components/CategoryShowcase.tsx'), 'utf8');

    const indirizziScritti = sorgente.match(/https?:\/\/[^\s'"`]+/g) ?? [];

    expect(
      indirizziScritti,
      `Una foto scritta nel codice non si cambia dal pannello: si cambia ripubblicando il sito. Trovate: ${indirizziScritti.join(', ')}`,
    ).toEqual([]);
  });

  it('gli host che accettiamo sono quelli che la regola di sicurezza lascia passare davvero', () => {
    const middleware = readFileSync(path.join(RADICE, 'middleware.ts'), 'utf8');
    const riga = middleware.split('\n').find((r) => r.includes('img-src'));

    expect(riga, 'La riga img-src della Content-Security-Policy è sparita da middleware.ts').toBeTruthy();

    for (const host of HOST_FOTO_AMMESSI) {
      expect(
        riga!.includes(host),
        `lib/immagine-categoria.ts accetta «${host}», ma img-src non lo lascia più passare: quelle foto sarebbero bloccate dal browser e la tessera resterebbe muta. Allinea i due elenchi.`,
      ).toBe(true);
    }

    // Lo Storage nella CSP non è scritto per esteso: è il host del NOSTRO
    // progetto, interpolato (`https://${supaHost}`, che senza configurazione
    // ricade su `*.supabase.co`). Qui si controlla che quel permesso ci sia
    // ancora, non la stringa.
    expect(
      riga!.includes('${supaHost}') || riga!.includes(SUFFISSO_HOST_STORAGE),
      `img-src non lascia più passare lo Storage: le foto di categoria caricate da noi (${SUFFISSO_HOST_STORAGE}) verrebbero bloccate dal browser.`,
    ).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { getImageProps } from 'next/image';
import caricatoreFotoRemote from '@/lib/image-loader';

/**
 * #99 — METÀ DELLE FOTO RESTAVA A 400 PIXEL SU OGNI TELEFONO.
 *
 * Ventinove immagini su sessantotto erano marcate `unoptimized`. La scelta
 * aveva una logica — il ridimensionamento lo fa il CDN di Supabase invece
 * della CPU del server che paghiamo — ma `unoptimized` fa anche una cosa che
 * nessuno aveva messo per iscritto: Next azzera `srcSet` E `sizes`. Cioè
 * l'attributo `sizes` scritto accanto all'immagine non faceva più niente, e la
 * foto restava a 400 pixel per tutti. Su un telefono a 3× che mostra la scheda
 * a 45vw ne servirebbero circa 540.
 *
 * Qui si prova il comportamento vero, chiamando la funzione di Next che
 * costruisce gli attributi dell'immagine.
 */

const FOTO = 'https://esempio.supabase.co/storage/v1/object/public/products/pane.jpg';
const SIZES = '(min-width: 1024px) 220px, (min-width: 640px) 33vw, 45vw';

describe('le foto dei prodotti si adattano allo schermo', () => {
  it('con `unoptimized` Next cancella srcSet e sizes: era questo il difetto', () => {
    const { props } = getImageProps({
      src: FOTO, alt: '', width: 400, height: 400, sizes: SIZES, unoptimized: true,
    });
    expect(props.srcSet).toBeUndefined();
    expect(props.sizes).toBeUndefined();
  });

  it('col caricatore, srcSet e sizes ci sono e portano larghezze diverse', () => {
    const { props } = getImageProps({
      src: FOTO, alt: '', width: 400, height: 400, sizes: SIZES, loader: caricatoreFotoRemote,
    });
    expect(props.sizes).toBe(SIZES);
    expect(props.srcSet).toBeTruthy();

    const larghezze = [...(props.srcSet ?? '').matchAll(/(\d+)w/g)].map((m) => Number(m[1]));
    expect(larghezze.length).toBeGreaterThan(2);
    // Serve almeno una variante grande abbastanza per uno schermo denso.
    expect(Math.max(...larghezze)).toBeGreaterThanOrEqual(640);
  });

  it('ogni variante chiede a Supabase proprio quella larghezza', () => {
    const { props } = getImageProps({
      src: FOTO, alt: '', width: 400, height: 400, sizes: SIZES, loader: caricatoreFotoRemote,
    });
    for (const pezzo of (props.srcSet ?? '').split(', ')) {
      const [indirizzo, etichetta] = pezzo.trim().split(' ');
      const larghezza = etichetta.replace('w', '');
      expect(new URL(indirizzo).searchParams.get('width')).toBe(larghezza);
      // E resta sul CDN di Supabase, non sulla CPU del nostro server.
      expect(indirizzo).toContain('/render/image/public/');
    }
  });

  it('il ridimensionamento non passa dal nostro server', () => {
    const { props } = getImageProps({
      src: FOTO, alt: '', width: 400, height: 400, sizes: SIZES, loader: caricatoreFotoRemote,
    });
    // `/_next/image` è l'ottimizzatore interno: se comparisse qui vorrebbe dire
    // che stiamo pagando noi la CPU di ogni foto di ogni negozio.
    expect(props.src).not.toContain('/_next/image');
    expect(props.srcSet).not.toContain('/_next/image');
  });

  it('i percorsi locali restano quello che sono', () => {
    expect(caricatoreFotoRemote({ src: '/icona.png', width: 64, quality: 75 })).toBe('/icona.png');
  });

  it('un host che non sa ridimensionare non viene rotto', () => {
    const fuori = 'https://placehold.co/400x400';
    expect(caricatoreFotoRemote({ src: fuori, width: 800, quality: 75 })).toBe(fuori);
  });
});

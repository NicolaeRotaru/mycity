import { ImageResponse } from 'next/og';
import {
  caratteriDelMarchio,
  MARCHIO_FONT_FAMILY,
  MARCHIO_FONT_WEIGHT,
} from './carattere-del-marchio';

export const runtime = 'edge';
export const alt = 'MyCity Piacenza — il marketplace dei negozi della tua città';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Open Graph image di default (home e pagine senza OG dedicata).
 * On-brand: gradiente terracotta + wordmark mostarda, niente palette off-brand.
 *
 * 3/9/2026 — il marchio esce in Fraunces, il carattere vero del logotipo. Prima
 * non veniva passato nessun carattere e la scritta «MyCity» usciva in quello di
 * riserva di chi disegna l'immagine: ogni link incollato in chat mostrava il
 * logo di un'altra azienda. Il perché e il come stanno in `carattere-del-marchio.ts`.
 */
export default async function RootOG() {
  const fonts = await caratteriDelMarchio();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          background: 'linear-gradient(135deg, #D55F3F 0%, #A03B25 100%)',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
          padding: 80,
        }}
      >
        <div
          style={{
            display: 'flex',
            fontFamily: MARCHIO_FONT_FAMILY,
            fontSize: 128,
            fontWeight: MARCHIO_FONT_WEIGHT,
            lineHeight: 1,
          }}
        >
          <span style={{ color: '#F4BC53' }}>My</span>
          <span>City</span>
        </div>
        <div style={{ fontSize: 46, fontWeight: 700, marginTop: 28 }}>
          I negozi di Piacenza, a casa tua
        </div>
        <div style={{ fontSize: 30, opacity: 0.92, marginTop: 16 }}>
          Ordini dai commercianti del tuo quartiere · consegna in 30-60 min · paghi alla consegna
        </div>
      </div>
    ),
    // `fonts` è `undefined` se il file non si legge: l'immagine viene lo stesso,
    // col carattere di riserva. Un elenco vuoto, invece, la ucciderebbe.
    { ...size, fonts },
  );
}

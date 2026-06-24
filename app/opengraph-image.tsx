import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'MyCity Piacenza — il marketplace dei negozi della tua città';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Open Graph image di default (home e pagine senza OG dedicata).
 * On-brand: gradiente terracotta + wordmark mostarda, niente palette off-brand.
 */
export default function RootOG() {
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
        <div style={{ display: 'flex', fontSize: 128, fontWeight: 900, lineHeight: 1 }}>
          <span style={{ color: '#F4BC53' }}>My</span>
          <span>City</span>
        </div>
        <div style={{ fontSize: 46, fontWeight: 700, marginTop: 28 }}>
          I negozi di Piacenza, a casa tua
        </div>
        <div style={{ fontSize: 30, opacity: 0.92, marginTop: 16 }}>
          Ordini dai commercianti del tuo quartiere · consegna in 24–48h · paghi alla consegna
        </div>
      </div>
    ),
    { ...size },
  );
}

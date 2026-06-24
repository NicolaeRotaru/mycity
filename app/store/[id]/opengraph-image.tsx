import { ImageResponse } from 'next/og';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'edge';
export const alt = 'Negozio su MyCity';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type StoreOGData = { store_name: string | null; store_description: string | null; store_logo: string | null; city: string | null };

async function fetchStore(id: string): Promise<StoreOGData | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await supabase
      .from('profiles')
      .select('store_name, store_description, store_logo, city')
      .eq('id', id)
      .eq('role', 'seller')
      .single();
    return (data as unknown as StoreOGData) ?? null;
  } catch {
    return null;
  }
}

export default async function StoreOG({ params }: { params: { id: string } }) {
  const s = await fetchStore(params.id);
  const name = s?.store_name ?? 'Negozio su MyCity';
  const city = s?.city ?? 'Piacenza';
  const desc = s?.store_description ?? 'Acquista direttamente dal negozio della tua città.';
  const logo = s?.store_logo ?? null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #D55F3F 0%, #A03B25 100%)',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
          padding: 60,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 36, fontWeight: 800, color: '#F4BC53' }}>My</span>
          <span style={{ fontSize: 36, fontWeight: 800 }}>City</span>
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 40, marginTop: 30 }}>
          <div style={{
            width: 220,
            height: 220,
            borderRadius: 24,
            background: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
          }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" width={220} height={220} style={{ objectFit: 'cover' }} />
            ) : (
              <div style={{ fontSize: 130, fontWeight: 900, color: '#A03B25' }}>My</div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
            <div style={{ fontSize: 60, fontWeight: 900, lineHeight: 1.05 }}>
              {name.length > 36 ? name.slice(0, 33) + '…' : name}
            </div>
            <div style={{ fontSize: 26, opacity: 0.95, lineHeight: 1.3 }}>
              {desc.length > 120 ? desc.slice(0, 117) + '…' : desc}
            </div>
            <div style={{ fontSize: 22, marginTop: 4, opacity: 0.9 }}>
              {city}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, opacity: 0.9 }}>
          <span>Acquista locale · consegna in 24-48h · pagamento alla consegna</span>
        </div>
      </div>
    ),
    { ...size },
  );
}

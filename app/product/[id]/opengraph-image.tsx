import { ImageResponse } from 'next/og';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'edge';
export const alt = 'Prodotto su MyCity';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

async function fetchProduct(id: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await supabase
      .from('products')
      .select('name, price, images, profiles!products_seller_id_fkey ( store_name )')
      .eq('id', id)
      .single();
    return data as any;
  } catch {
    return null;
  }
}

/**
 * Open Graph image generata on-demand per ogni prodotto.
 * Quando un utente condivide il link prodotto su WhatsApp / Telegram / FB
 * il preview mostra titolo + prezzo + nome negozio + (se disponibile) foto.
 *
 * Rendering server-side via @vercel/og (incluso in Next.js).
 */
export default async function ProductOG({ params }: { params: { id: string } }) {
  const p = await fetchProduct(params.id);
  const name = p?.name ?? 'Prodotto su MyCity';
  const store = p?.profiles?.store_name ?? 'MyCity Piacenza';
  const price = typeof p?.price === 'number' ? `€${p.price.toFixed(2)}` : '';
  const photo = Array.isArray(p?.images) && p?.images[0] ? p.images[0] : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Left: photo */}
        <div style={{
          width: '45%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'white',
          padding: 40,
        }}>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt=""
              width={460}
              height={460}
              style={{ objectFit: 'contain', maxWidth: '100%', maxHeight: '100%' }}
            />
          ) : (
            <div style={{ fontSize: 160 }}>🛍️</div>
          )}
        </div>

        {/* Right: info */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '50px 50px 40px 50px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 36, fontWeight: 800, color: '#fbbf24' }}>My</span>
            <span style={{ fontSize: 36, fontWeight: 800 }}>City</span>
            <span style={{ fontSize: 18, opacity: 0.7, marginLeft: 8 }}>Piacenza</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1 }}>
              {name.length > 60 ? name.slice(0, 57) + '…' : name}
            </div>
            {price && (
              <div style={{
                fontSize: 64,
                fontWeight: 900,
                color: '#fbbf24',
              }}>{price}</div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 22, opacity: 0.9 }}>
            <span>📦 Venduto da</span>
            <span style={{ fontWeight: 700 }}>{store}</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

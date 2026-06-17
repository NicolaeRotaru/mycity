import React from 'react';
import { Badge } from '../core/Badge.jsx';

/**
 * MyCity ProductCard — the marketplace's signature card. Photo dominant
 * (square), compact body: store chip · title · price · discreet "+" add.
 * Hover lifts the card and zooms the photo. Bound to the design tokens.
 */
function formatPrice(n) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
}

// Branded fallback shown if a product photo fails to load (no broken grey boxes).
const MC_FALLBACK_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FBF7F0"/><stop offset="1" stop-color="#F5EDD9"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><g fill="none" stroke="#D9B36F" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M150 250l45-55 35 40 30-35 40 50"/><circle cx="165" cy="160" r="22"/></g><rect x="120" y="120" width="160" height="160" rx="16" fill="none" stroke="#E6CC95" stroke-width="8"/></svg>`
);

export function ProductCard({
  name, price, image, storeName, discountPercent, stock,
  isNew = false, freeShipping = false, onAdd, onFav, favorite = false, href, style,
}) {
  const [hover, setHover] = React.useState(false);
  const [fav, setFav] = React.useState(favorite);
  const hasDiscount = discountPercent > 0;
  const finalPrice = hasDiscount ? price * (1 - discountPercent / 100) : price;
  const outOfStock = stock === 0;
  const lowStock = stock > 0 && stock <= 3;
  const initials = (storeName || '').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase();

  const Tag = href ? 'a' : 'div';
  return (
    <Tag href={href}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column', height: '100%',
        overflow: 'hidden', borderRadius: 'var(--radius-2xl)',
        border: `1px solid ${hover ? 'var(--primary-200)' : 'var(--surface-200)'}`,
        background: 'var(--surface-0)', textDecoration: 'none',
        boxShadow: hover ? 'var(--shadow-warm-lg)' : 'none',
        transform: hover ? 'translateY(-4px)' : 'translateY(0)',
        transition: 'transform var(--dur-base) var(--ease-out-quint), box-shadow var(--dur-base), border-color var(--dur-base)',
        ...style,
      }}>
      {/* badges */}
      <div style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 2, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {hasDiscount && <Badge variant="discount">-{discountPercent}%</Badge>}
        {isNew && <Badge variant="new">Nuovo</Badge>}
        {outOfStock && <Badge variant="soldout">Esaurito</Badge>}
      </div>
      {/* photo */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', overflow: 'hidden', background: 'var(--surface-100)' }}>
        {image
          ? <img src={image} alt={name} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = MC_FALLBACK_IMG; }} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: hover ? 'scale(1.08)' : 'scale(1)', transition: 'transform var(--dur-slow) var(--ease-out-quint)' }} />
          : <img src={MC_FALLBACK_IMG} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        <button type="button" aria-label="Preferiti"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFav((v) => !v); onFav?.(); }}
          style={{ position: 'absolute', top: '8px', right: '8px', width: '28px', height: '28px', borderRadius: 'var(--radius-full)', border: 0, background: 'rgba(255,255,255,.95)', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill={fav ? 'var(--secondary-500)' : 'none'} stroke={fav ? 'var(--secondary-500)' : 'var(--ink-400)'} strokeWidth="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.5 4.04 3 5.5l7 7Z"/></svg>
        </button>
      </div>
      {/* body */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, padding: '10px' }}>
        {storeName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '16px', height: '16px', flexShrink: 0, borderRadius: 'var(--radius-full)', background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', color: '#fff', fontSize: '8px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-sans)' }}>{initials}</span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600, color: 'var(--ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{storeName}</span>
          </div>
        )}
        <h3 style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600, lineHeight: 1.3, color: hover ? 'var(--primary-700)' : 'var(--ink-900)', transition: 'color var(--dur-base)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '2.6em' }}>{name}</h3>

        {(freeShipping || lowStock) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
            {lowStock && !outOfStock && <Badge variant="lowstock" icon="flame">{stock === 1 ? 'Ultimo pezzo' : `Ultimi ${stock}`}</Badge>}
            {freeShipping && <Badge variant="free" icon="truck">Sped. gratis</Badge>}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: 'auto', paddingTop: '4px' }}>
          {hasDiscount ? (
            <>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: '16px', fontWeight: 800, color: 'var(--secondary-600)' }}>{formatPrice(finalPrice)}</span>
              <span style={{ fontSize: '11px', color: 'var(--ink-400)', textDecoration: 'line-through' }}>{formatPrice(price)}</span>
            </>
          ) : (
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '16px', fontWeight: 800, color: 'var(--ink-900)' }}>{formatPrice(price)}</span>
          )}
          <button type="button" aria-label="Aggiungi al carrello" disabled={outOfStock}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAdd?.(); }}
            style={{ marginLeft: 'auto', width: '28px', height: '28px', flexShrink: 0, borderRadius: 'var(--radius-md)', border: 0, background: outOfStock ? 'var(--cream-200)' : 'var(--primary-600)', color: outOfStock ? 'var(--ink-400)' : '#fff', cursor: outOfStock ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-sm)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>
    </Tag>
  );
}

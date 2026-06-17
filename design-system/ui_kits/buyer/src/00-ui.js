// ===== Shared UI helpers (concat order: first) =====
const { Button, Badge, Card, ProductCard, OrderStatusBadge, Modal, EmptyState, Input, Field, Select, Checkbox } = window.MyCityDesignSystem_105480;

const fmt = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
const imgUrl = (kw, lock) => `https://loremflickr.com/640/640/${kw}?lock=${lock}`;
const finalPrice = (p) => (p.discountPercent > 0 ? p.price * (1 - p.discountPercent / 100) : p.price);
const storeBy = (name) => window.MC_STORES.find((s) => s.name === name);
const initials = (name) => (name || '').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase();

function Lucide({ name, size = 20, stroke = 2, color, style }) {
  return <i data-lucide={name} ref={(el) => { if (el && window.lucide) try { window.lucide.createIcons({ attrs: { width: size, height: size, 'stroke-width': stroke } }); } catch (e) {} }} style={{ width: size, height: size, display: 'inline-flex', color, flexShrink: 0, ...style }} />;
}

// Star rating row (read-only).
function Stars({ value = 5, size = 14 }) {
  return (
    <span style={{ display: 'inline-flex', gap: '1px' }} aria-label={`${value} su 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24"
          fill={i <= Math.round(value) ? 'var(--accent-500)' : 'var(--cream-300)'} stroke="none">
          <path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}

// Store avatar chip (initials on terracotta gradient).
function StoreChip({ name, size = 20, onClick }) {
  return (
    <span onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: onClick ? 'pointer' : 'default' }}>
      <span style={{ width: size, height: size, flexShrink: 0, borderRadius: 'var(--radius-full)', background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', color: '#fff', fontSize: size * 0.42, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-sans)' }}>{initials(name)}</span>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600, color: 'var(--primary-700)', whiteSpace: 'nowrap' }}>{name}</span>
    </span>
  );
}

// Lightweight toast (non-intrusive add-to-cart confirmation).
function Toast({ toast, onUndo }) {
  if (!toast) return null;
  return ReactDOM.createPortal(
    <div style={{ position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: 'var(--z-toast)', display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--ink-900)', color: '#fff', padding: '12px 16px', borderRadius: 'var(--radius-full)', boxShadow: 'var(--shadow-warm-xl)', animation: 'mc-pop-in var(--dur-medium) var(--ease-out-quint)', maxWidth: '90vw' }}>
      <span style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--olive-600)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Lucide name="check" size={16} stroke={3} color="#fff" /></span>
      <span style={{ fontSize: '14px', fontWeight: 500 }}>{toast.text}</span>
      {onUndo && <button onClick={onUndo} style={{ border: 0, background: 'transparent', color: 'var(--accent-400)', fontWeight: 700, fontSize: '14px', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>Annulla</button>}
    </div>,
    document.body,
  );
}

// "Aperto / Chiuso" pill based on store.closeAt (demo: always open until close).
function OpenPill({ store, dark }) {
  const open = true;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: dark ? 'rgba(28,26,24,.78)' : 'var(--olive-50)', color: dark ? '#fff' : 'var(--olive-700)', fontSize: '12px', fontWeight: 600, padding: '4px 10px', borderRadius: 'var(--radius-full)' }}>
      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--olive-400)' }} />
      {open ? `Aperto · chiude alle ${store.closeAt}` : 'Chiuso'}
    </span>
  );
}

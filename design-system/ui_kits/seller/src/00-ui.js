// ===== Shared (concat first) =====
const { Button, Badge, Card, OrderStatusBadge, Modal, EmptyState, Input, Select, Checkbox } = window.MyCityDesignSystem_105480;

const fmt = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
const img = (kw, lock) => `https://loremflickr.com/640/640/${kw}?lock=${lock}`;
const initials = (name) => (name || '').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase();

function Lucide({ name, size = 20, stroke = 2, color, style }) {
  return <i data-lucide={name} ref={(el) => { if (el && window.lucide) try { window.lucide.createIcons({ attrs: { width: size, height: size, 'stroke-width': stroke } }); } catch (e) {} }} style={{ width: size, height: size, display: 'inline-flex', color, flexShrink: 0, ...style }} />;
}
function Stars({ value = 5, size = 14 }) {
  return <span style={{ display: 'inline-flex', gap: '1px' }}>{[1,2,3,4,5].map((i) => (
    <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill={i <= Math.round(value) ? 'var(--accent-500)' : 'var(--cream-300)'}><path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z" /></svg>
  ))}</span>;
}

const TINT = {
  primary:   ['var(--primary-100)', 'var(--primary-700)'],
  olive:     ['var(--olive-100)', 'var(--olive-700)'],
  accent:    ['var(--accent-100)', 'var(--accent-700)'],
  secondary: ['var(--secondary-100)', 'var(--secondary-600)'],
};

function PageTitle({ title, sub, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
      <div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '30px', fontWeight: 800, color: 'var(--ink-900)' }}>{title}</h1>
        {sub && <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--ink-500)' }}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

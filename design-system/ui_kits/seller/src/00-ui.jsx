// ===== Seller shared UI (DS wrappers + atoms) =====
const __ds = (n) => function DSComp(props) {
  const C = (window.MyCityDesignSystem_105480 || {})[n];
  return C ? React.createElement(C, props) : null;
};
const Button = __ds('Button');
const Badge = __ds('Badge');
const Card = __ds('Card');
const OrderStatusBadge = __ds('OrderStatusBadge');
const Modal = __ds('Modal');
const EmptyState = __ds('EmptyState');
const Input = __ds('Input');
const Select = __ds('Select');
const Checkbox = __ds('Checkbox');

const fmt = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
const imgUrl = (kw, lock) => `https://loremflickr.com/300/300/${kw}?lock=${lock}`;
const initials = (s) => (s || '').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase();

function Icon({ name, size = 20, stroke = 2, color, style }) {
  return <i data-lucide={name} ref={(el) => { if (el && window.lucide) try { window.lucide.createIcons({ attrs: { width: size, height: size, 'stroke-width': stroke } }); } catch (e) {} }} style={{ width: size, height: size, display: 'inline-flex', color, flexShrink: 0, ...style }} />;
}

const TONES = {
  olive: ['var(--olive-100)', 'var(--olive-700)'],
  primary: ['var(--primary-100)', 'var(--primary-700)'],
  accent: ['var(--accent-100)', 'var(--accent-700)'],
  secondary: ['var(--secondary-100)', 'var(--secondary-600)'],
};

function StatCard({ kpi }) {
  const t = TONES[kpi.tone] || TONES.primary;
  const up = kpi.delta > 0, flat = kpi.delta === 0;
  return (
    <Card variant="bordered" padding="lg">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-500)', fontWeight: 600 }}>{kpi.label}</p>
          <p style={{ margin: '8px 0 0', fontFamily: 'var(--font-serif)', fontSize: '30px', fontWeight: 800, color: 'var(--ink-900)', lineHeight: 1 }}>{kpi.value}</p>
        </div>
        <span style={{ width: '44px', height: '44px', borderRadius: 'var(--radius-lg)', background: t[0], color: t[1], display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={kpi.icon} size={22} stroke={2.2} color={t[1]} /></span>
      </div>
      {!flat && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '12px', fontSize: '13px', fontWeight: 700, color: up ? 'var(--olive-700)' : 'var(--secondary-600)' }}>
          <Icon name={up ? 'trending-up' : 'trending-down'} size={15} color={up ? 'var(--olive-600)' : 'var(--secondary-600)'} /> {up ? '+' : ''}{kpi.delta}% <span style={{ color: 'var(--ink-400)', fontWeight: 500 }}>vs mese scorso</span>
        </div>
      )}
      {flat && <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--ink-400)' }}>da saldare al prossimo giro rider</div>}
    </Card>
  );
}

// Simple inline SVG sparkline / bar chart.
function Sparkline({ data, w = 560, h = 120, color = 'var(--primary-600)' }) {
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => [i / (data.length - 1) * w, h - ((v - min) / (max - min || 1)) * (h - 10) - 5]);
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = path + ` L${w} ${h} L0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <defs><linearGradient id="scfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--primary-500)" stopOpacity="0.22" /><stop offset="1" stopColor="var(--primary-500)" stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill="url(#scfill)" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => i === pts.length - 1 ? <circle key={i} cx={p[0]} cy={p[1]} r="4" fill={color} /> : null)}
    </svg>
  );
}

function Bars({ data, h = 120, color = 'var(--accent-500)' }) {
  const max = Math.max(...data);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: h }}>
      {data.map((v, i) => <div key={i} title={fmt(v)} style={{ flex: 1, height: `${(v / max) * 100}%`, background: i === data.length - 1 ? 'var(--primary-600)' : color, borderRadius: '4px 4px 0 0', minHeight: '4px' }} />)}
    </div>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
      <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 700, color: 'var(--ink-900)' }}>{children}</h2>
      {action}
    </div>
  );
}

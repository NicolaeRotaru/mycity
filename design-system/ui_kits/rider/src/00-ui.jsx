// ===== Rider shared UI (DS wrappers + mobile chrome) =====
const __ds = (n) => function DSComp(props) { const C = (window.MyCityDesignSystem_105480 || {})[n]; return C ? React.createElement(C, props) : null; };
const Button = __ds('Button');
const Badge = __ds('Badge');
const Card = __ds('Card');
const OrderStatusBadge = __ds('OrderStatusBadge');

const fmt = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
const initials = (s) => (s || '').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase();

function Icon({ name, size = 22, stroke = 2, color, style }) {
  return <i data-lucide={name} ref={(el) => { if (el && window.lucide) try { window.lucide.createIcons({ attrs: { width: size, height: size, 'stroke-width': stroke } }); } catch (e) {} }} style={{ width: size, height: size, display: 'inline-flex', color, flexShrink: 0, ...style }} />;
}

// Phone frame — 390×844, scaled to fit the card.
function PhoneFrame({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 50% 0%, #2c2a28, #1c1a18)', padding: '24px' }}>
      <div style={{ width: '390px', height: '844px', background: 'var(--surface-50)', borderRadius: '44px', boxShadow: '0 40px 80px -20px rgba(0,0,0,.6), inset 0 0 0 11px #0b0a0a, inset 0 0 0 13px #2a2a2a', overflow: 'hidden', position: 'relative' }}>
        {/* notch */}
        <div style={{ position: 'absolute', top: '0', left: '50%', transform: 'translateX(-50%)', width: '150px', height: '30px', background: '#0b0a0a', borderRadius: '0 0 18px 18px', zIndex: 60 }} />
        <div style={{ position: 'absolute', inset: '0', borderRadius: '33px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function StatusBar({ dark }) {
  const c = dark ? '#fff' : 'var(--ink-900)';
  return (
    <div style={{ height: '44px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 26px 0 30px', fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 700, color: c, zIndex: 50 }}>
      <span>9:41</span>
      <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}><Icon name="signal" size={16} color={c} /><Icon name="wifi" size={16} color={c} /><Icon name="battery-full" size={18} color={c} /></span>
    </div>
  );
}

function BottomTab({ active, onNav }) {
  const items = [['home', 'home', 'Consegne'], ['guadagni', 'wallet', 'Guadagni'], ['storico', 'history', 'Storico'], ['profilo', 'user', 'Profilo']];
  return (
    <div style={{ flexShrink: 0, height: '76px', background: 'var(--surface-0)', borderTop: '1px solid var(--cream-300)', display: 'flex', paddingBottom: '14px' }}>
      {items.map(([id, icon, label]) => {
        const on = active === id;
        return (
          <button key={id} onClick={() => onNav(id)} style={{ flex: 1, border: 0, background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px', cursor: 'pointer', color: on ? 'var(--primary-700)' : 'var(--ink-400)', fontFamily: 'var(--font-sans)', paddingTop: '8px' }}>
            <Icon name={icon} size={22} stroke={on ? 2.4 : 2} color={on ? 'var(--primary-700)' : 'var(--ink-400)'} />
            <span style={{ fontSize: '11px', fontWeight: on ? 700 : 500 }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Faux map with a route line + two pins.
function MapStub({ height = 220 }) {
  return (
    <div style={{ position: 'relative', height, background: 'linear-gradient(135deg, #eef1ea, #e3e8dc)', overflow: 'hidden' }}>
      <svg viewBox="0 0 390 220" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        {[40, 90, 140, 190].map((y) => <line key={'h' + y} x1="0" y1={y} x2="390" y2={y} stroke="#d2d8c8" strokeWidth="1" />)}
        {[60, 130, 200, 270, 340].map((x) => <line key={'v' + x} x1={x} y1="0" x2={x} y2="220" stroke="#d2d8c8" strokeWidth="1" />)}
        <path d="M70 170 Q120 150 150 120 T280 60" fill="none" stroke="var(--primary-600)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 9" />
      </svg>
      <span style={{ position: 'absolute', left: '58px', top: '152px' }}><Pin color="var(--ink-800)" icon="store" /></span>
      <span style={{ position: 'absolute', left: '262px', top: '40px' }}><Pin color="var(--primary-600)" icon="map-pin" /></span>
      <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '18px', height: '18px', borderRadius: '50%', background: 'var(--info)', border: '3px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,.3)' }} />
    </div>
  );
}
function Pin({ color, icon }) {
  return <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}><span style={{ width: '30px', height: '30px', borderRadius: '50% 50% 50% 0', background: color, transform: 'rotate(-45deg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(0,0,0,.3)' }}><span style={{ transform: 'rotate(45deg)' }}><Icon name={icon} size={15} color="#fff" /></span></span></span>;
}

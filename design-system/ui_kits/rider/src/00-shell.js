// ===== Shared + phone shell =====
const { Button, Badge, Card, OrderStatusBadge, Modal, EmptyState } = window.MyCityDesignSystem_105480;
const fmt = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
const initials = (name) => (name || '').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase();
function Lucide({ name, size = 20, stroke = 2, color, style }) {
  return <i data-lucide={name} ref={(el) => { if (el && window.lucide) try { window.lucide.createIcons({ attrs: { width: size, height: size, 'stroke-width': stroke } }); } catch (e) {} }} style={{ width: size, height: size, display: 'inline-flex', color, flexShrink: 0, ...style }} />;
}

const RD_TABS = [
  { id: 'home', icon: 'bike', label: 'Consegne' },
  { id: 'earnings', icon: 'wallet', label: 'Guadagni' },
  { id: 'availability', icon: 'calendar-clock', label: 'Turni' },
  { id: 'profile', icon: 'user', label: 'Profilo' },
];

// Phone frame: centers a 390×every-tall device on a warm backdrop.
function Phone({ children, tab, onTab }) {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, var(--cream-200), var(--cream-100))', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ width: '390px', height: '844px', maxHeight: '92vh', background: 'var(--surface-50)', borderRadius: '44px', boxShadow: '0 0 0 12px var(--ink-900), 0 30px 60px -15px rgba(28,26,24,.5)', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {/* status bar */}
        <div style={{ height: '44px', flexShrink: 0, background: 'var(--surface-0)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', position: 'relative', zIndex: 5 }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink-900)' }}>9:41</span>
          <span style={{ position: 'absolute', left: '50%', top: '8px', transform: 'translateX(-50%)', width: '110px', height: '26px', background: 'var(--ink-900)', borderRadius: '999px' }} />
          <span style={{ display: 'inline-flex', gap: '5px', alignItems: 'center', color: 'var(--ink-900)' }}><Lucide name="signal" size={15} color="var(--ink-900)" /><Lucide name="wifi" size={15} color="var(--ink-900)" /><Lucide name="battery-full" size={17} color="var(--ink-900)" /></span>
        </div>
        {/* scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>{children}</div>
        {/* bottom tab bar */}
        <nav style={{ flexShrink: 0, background: 'var(--surface-0)', borderTop: '1px solid var(--cream-300)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', padding: '8px 4px 22px' }}>
          {RD_TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button key={t.id} onClick={() => onTab(t.id)} style={{ border: 0, background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', padding: '4px', color: on ? 'var(--primary-700)' : 'var(--ink-400)', fontFamily: 'var(--font-sans)' }}>
                <Lucide name={t.icon} size={22} stroke={on ? 2.4 : 2} color={on ? 'var(--primary-700)' : 'var(--ink-400)'} />
                <span style={{ fontSize: '10px', fontWeight: on ? 700 : 500 }}>{t.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function ScreenHead({ title, sub, right }) {
  return (
    <div style={{ padding: '16px 20px 8px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
      <div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '26px', fontWeight: 800, color: 'var(--ink-900)' }}>{title}</h1>
        {sub && <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-500)' }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}
